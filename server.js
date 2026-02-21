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
      const waitingByMode = {
        "4": waitingQueues["4"].length,
        "6": waitingQueues["6"].length,
        "9": waitingQueues["9"].length,
        "9expert": waitingQueues["9expert"].length,
      };
      const totalWaiting = Object.values(waitingByMode).reduce((a, b) => a + b, 0);

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
        waitingPlayers: totalWaiting,
        waitingByMode,
        liveMatches
      });
    }

    // Send initial stats on connect
    broadcastLobbyStats();

    socket.on("findMatch", ({ mode, name, playerId } = {}) => {
      // Validate mode, default to 9
      const gridMode = ["4", "6", "9", "9expert"].includes(mode) ? mode : "9";
      const playerName = name || "Anonymous";
      const pid = playerId || socket.id; // Fallback to socket id if no persistent pid
      console.log(socket.id, "finding match mode:", gridMode, "as:", playerName, "(", pid, ")");

      const queue = waitingQueues[gridMode];

      if (queue.length > 0) {
        const opponent = queue.pop();
        const opponentId = opponent.id; // socket id
        const opponentPid = opponent.pid; // persistent id
        const opponentName = opponent.name;

        if (opponentPid === pid) {
          queue.push({ id: socket.id, pid, name: playerName });
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
          p1: { id: opponentId, pid: opponentPid, name: opponentName, progress: puzzle.split("") },
          p2: { id: socket.id, pid: pid, name: playerName, progress: puzzle.split("") },
          status: "playing",
          timeouts: {}
        });

        const opponentSocket = io.sockets.sockets.get(opponentId);
        if (opponentSocket) {
          opponentSocket.join(matchId);
          opponentSocket.emit("matchFound", {
            matchId,
            puzzle,
            mode: gridMode,
            player: "p1",
            opponentName: playerName
          });
        }
        socket.join(matchId);
        socket.emit("matchFound", {
          matchId,
          puzzle,
          mode: gridMode,
          player: "p2",
          opponentName: opponentName
        });

        console.log("Match created", matchId, "mode:", gridMode);
        broadcastLobbyStats();
      } else {
        queue.push({ id: socket.id, pid, name: playerName });
        socket.emit("waiting", { mode: gridMode });
        broadcastLobbyStats();
      }
    });

    socket.on("rejoinMatch", ({ matchId, playerId }) => {
      const match = matches.get(matchId);
      if (!match) {
        socket.emit("error", { message: "Match not found or expired" });
        return;
      }

      // Find which player is rejoining by PID
      const playerKey = match.p1.pid === playerId ? "p1" : match.p2.pid === playerId ? "p2" : null;
      if (!playerKey) {
        socket.emit("error", { message: "Not a participant in this match" });
        return;
      }

      const player = match[playerKey];
      const opponentKey = playerKey === "p1" ? "p2" : "p1";
      const opponent = match[opponentKey];

      // Update socket ID and clear any disconnect timeout
      player.id = socket.id;
      if (match.timeouts && match.timeouts[playerKey]) {
        clearTimeout(match.timeouts[playerKey]);
        delete match.timeouts[playerKey];
      }

      socket.join(matchId);
      socket.emit("matchFound", {
        matchId,
        puzzle: match.puzzle,
        mode: match.mode,
        player: playerKey,
        opponentName: opponent.name,
        // Send current progress to client
        currentProgress: player.progress,
        opponentFilled: opponent.progress.filter(x => x !== "-").length - match.initialFilled
      });

      console.log(`Player ${player.name} (${playerId}) rejoined ${matchId}`);
      broadcastLobbyStats();
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
        io.to(matchId).emit("gameOver", {
          winner: socket.id,
          winnerName: player.name,
          reason: "solved"
        });
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

    socket.on("leaveMatch", () => handleLeave(socket.id, true));
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      handleLeave(socket.id, false); // false means "might reconnect"
    });

    function handleLeave(socketId, immediate = false) {
      let statsChanged = false;
      // Remove from any waiting queue
      for (const q of Object.values(waitingQueues)) {
        const i = q.findIndex(p => p.id === socketId);
        if (i !== -1) {
          q.splice(i, 1);
          statsChanged = true;
        }
      }

      // Check active matches
      for (const [matchId, match] of matches.entries()) {
        const p1 = match.p1;
        const p2 = match.p2;

        if (p1.id === socketId || p2.id === socketId) {
          if (match.status === "playing") {
            const playerKey = p1.id === socketId ? "p1" : "p2";

            if (immediate) {
              const winnerKey = playerKey === "p1" ? "p2" : "p1";
              finishMatch(matchId, match, winnerKey, "opponent_disconnected");
              statsChanged = true;
            } else {
              // Disconnect: start grace period
              if (!match.timeouts) match.timeouts = {};
              match.timeouts[playerKey] = setTimeout(() => {
                const updatedMatch = matches.get(matchId);
                if (updatedMatch && updatedMatch.status === "playing") {
                  const winnerKey = playerKey === "p1" ? "p2" : "p1";
                  finishMatch(matchId, updatedMatch, winnerKey, "opponent_disconnected");
                  broadcastLobbyStats();
                }
              }, 10000); // 10s grace period
            }
          }
        }
      }
      if (statsChanged) broadcastLobbyStats();
    }

    function finishMatch(matchId, match, winnerKey, reason) {
      const winner = match[winnerKey];
      match.status = "finished";
      io.to(matchId).emit("gameOver", {
        winner: winner.id,
        winnerName: winner.name,
        reason: reason
      });
      matches.delete(matchId);
    }
  });

  httpServer
    .once("error", (err) => { console.error(err); process.exit(1); })
    .listen(port, () => console.log(`> Ready on http://${hostname}:${port}`));
});
