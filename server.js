import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import { getSudoku } from "sudoku-gen";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

const matches = new Map();
// Separate waiting queues per mode: "4", "6", "9", "9expert"
const waitingQueues = { "4": [], "6": [], "9": [], "9expert": [] };

// ─── Generic Sudoku Generator ──────────────────────────────────────────────────
function generateCustom(size, boxRows, boxCols, clues) {
  function isValid(board, row, col, num) {
    for (let c = 0; c < size; c++) if (board[row][c] === num) return false;
    for (let r = 0; r < size; r++) if (board[r][col] === num) return false;
    const br = Math.floor(row / boxRows) * boxRows;
    const bc = Math.floor(col / boxCols) * boxCols;
    for (let r = br; r < br + boxRows; r++)
      for (let c = bc; c < bc + boxCols; c++)
        if (board[r][c] === num) return false;
    return true;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function solve(board) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === 0) {
          const nums = shuffle(Array.from({ length: size }, (_, i) => i + 1));
          for (const n of nums) {
            if (isValid(board, r, c, n)) {
              board[r][c] = n;
              if (solve(board)) return true;
              board[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  const board = Array.from({ length: size }, () => Array(size).fill(0));
  solve(board);

  const solution = board.flat().join("");
  const puzzleBoard = board.map(r => [...r]);
  const positions = shuffle([...Array(size * size).keys()]);
  let removed = 0;
  const targetRemove = size * size - clues;
  for (const pos of positions) {
    if (removed >= targetRemove) break;
    const r = Math.floor(pos / size);
    const c = pos % size;
    puzzleBoard[r][c] = 0;
    removed++;
  }

  const puzzle = puzzleBoard.flat().map(v => (v === 0 ? "-" : String(v))).join("");
  return { puzzle, solution };
}

// ─── Puzzle factory ───────────────────────────────────────────────────────────
function generatePuzzle(mode) {
  if (mode === "4") return generateCustom(4, 2, 2, 8);
  if (mode === "6") return generateCustom(6, 2, 3, 18);
  if (mode === "9expert") {
    const s = getSudoku("expert");
    return { puzzle: s.puzzle, solution: s.solution };
  }
  // Default 9x9 Medium
  const s = getSudoku("medium");
  return { puzzle: s.puzzle, solution: s.solution };
}

// ─── Socket server ────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer);

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    function broadcastLobbyStats() {
      const activeMatchCount = matches.size;
      const waitingCount = waitingQueues["6"].length + waitingQueues["9"].length;

      const liveMatches = [];
      for (const [id, m] of matches.entries()) {
        if (m.status === "playing") {
          const totalToFill = m.puzzle.length - m.initialFilled;
          const p1Filled = m.p1.progress.filter(c => c !== "-").length - m.initialFilled;
          const p2Filled = m.p2.progress.filter(c => c !== "-").length - m.initialFilled;

          liveMatches.push({
            id,
            mode: m.mode,
            p1Progress: totalToFill > 0 ? Math.floor((p1Filled / totalToFill) * 100) : 0,
            p2Progress: totalToFill > 0 ? Math.floor((p2Filled / totalToFill) * 100) : 0,
          });
        }
      }

      io.emit("lobbyStats", {
        activeMatches: activeMatchCount,
        waitingPlayers: waitingCount,
        liveMatches
      });
    }

    // Send initial stats on connect
    broadcastLobbyStats();

    socket.on("findMatch", ({ mode } = {}) => {
      // Validate mode, default to 9
      const gridMode = ["4", "6", "9", "9expert"].includes(mode) ? mode : "9";
      console.log(socket.id, "finding match mode:", gridMode);

      const queue = waitingQueues[gridMode];

      if (queue.length > 0) {
        const opponentId = queue.pop();
        if (opponentId === socket.id) {
          queue.push(socket.id);
          return;
        }

        const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const { puzzle, solution } = generatePuzzle(gridMode);

        const initialFilled = puzzle.split("").filter(c => c !== "-").length;

        matches.set(matchId, {
          id: matchId,
          mode: gridMode,
          puzzle,
          solution,
          initialFilled,
          p1: { id: opponentId, progress: puzzle.split("") },
          p2: { id: socket.id, progress: puzzle.split("") },
          status: "playing",
        });

        const opponentSocket = io.sockets.sockets.get(opponentId);
        if (opponentSocket) {
          opponentSocket.join(matchId);
          opponentSocket.emit("matchFound", { matchId, puzzle, mode: gridMode, player: "p1" });
        }
        socket.join(matchId);
        socket.emit("matchFound", { matchId, puzzle, mode: gridMode, player: "p2" });

        console.log("Match created", matchId, "mode:", gridMode);
        broadcastLobbyStats();
      } else {
        queue.push(socket.id);
        socket.emit("waiting", { mode: gridMode });
        broadcastLobbyStats();
      }
    });

    socket.on("makeMove", ({ matchId, index, value }) => {
      const match = matches.get(matchId);
      if (!match || match.status !== "playing") return;

      const playerKey = match.p1.id === socket.id ? "p1" : match.p2.id === socket.id ? "p2" : null;
      if (!playerKey) return;

      const player = match[playerKey];
      player.progress[index] = value || "-";

      const isComplete = player.progress.join("") === match.solution;

      if (isComplete) {
        match.status = "finished";
        io.to(matchId).emit("gameOver", { winner: socket.id, reason: "solved" });
        matches.delete(matchId);
        broadcastLobbyStats();
      } else {
        const cellsFilled = player.progress.filter(x => x !== "-").length;
        io.to(matchId).emit("playerProgress", {
          playerId: socket.id,
          filled: cellsFilled,
          initialFilled: match.initialFilled,
          cellIndex: index,
          cleared: !value,
        });
        broadcastLobbyStats();
      }
    });

    socket.on("leaveMatch", () => handleLeave(socket.id));
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      handleLeave(socket.id);
    });

    function handleLeave(socketId) {
      let statsChanged = false;
      // Remove from any waiting queue
      for (const q of Object.values(waitingQueues)) {
        const i = q.indexOf(socketId);
        if (i !== -1) {
          q.splice(i, 1);
          statsChanged = true;
        }
      }
      // Check active matches
      for (const [matchId, match] of matches.entries()) {
        if (match.p1.id === socketId || match.p2.id === socketId) {
          if (match.status === "playing") {
            const winnerId = match.p1.id === socketId ? match.p2.id : match.p1.id;
            match.status = "finished";
            io.to(matchId).emit("gameOver", { winner: winnerId, reason: "opponent_disconnected" });
            matches.delete(matchId);
            statsChanged = true;
          }
        }
      }
      if (statsChanged) broadcastLobbyStats();
    }
  });

  httpServer
    .once("error", (err) => { console.error(err); process.exit(1); })
    .listen(port, () => console.log(`> Ready on http://${hostname}:${port}`));
});
