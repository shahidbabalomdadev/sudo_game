"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Trophy, Swords, XCircle, RotateCcw,
  Grid3X3, LayoutGrid
} from "lucide-react";

type GridMode = "4" | "6" | "9" | "9expert";

interface MatchStat {
  id: string;
  mode: string;
  p1Progress: number;
  p2Progress: number;
}

interface LobbyStats {
  activeMatches: number;
  waitingPlayers: number;
  waitingByMode: Record<string, number>;
  liveMatches: MatchStat[];
}

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [mounted, setMounted] = useState(false);
  const [gameState, setGameState] = useState<"idle" | "waiting" | "playing" | "finished">("idle");
  const [gridMode, setGridMode] = useState<GridMode>("9");
  const [matchId, setMatchId] = useState("");
  const [puzzle, setPuzzle] = useState<string[]>(Array(81).fill("-"));
  const [initialPuzzle, setInitialPuzzle] = useState<string[]>(Array(81).fill("-"));
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [activeGridSize, setActiveGridSize] = useState<number>(9);

  // Progress
  const [myFilled, setMyFilled] = useState(0);
  const [opponentFilled, setOpponentFilled] = useState(0);
  const [totalEmpty, setTotalEmpty] = useState(0);

  // Opponent cell-level tracking (which indices the opponent has answered)
  const [opponentCells, setOpponentCells] = useState<Set<number>>(new Set<number>());


  // Result
  const [winner, setWinner] = useState<string | null>(null);
  const [winnerName, setWinnerName] = useState("");
  const [winReason, setWinReason] = useState("");

  const [playerName, setPlayerName] = useState("Player");
  const [opponentName, setOpponentName] = useState("Opponent");
  const [playerId, setPlayerId] = useState("");

  const totalEmptyRef = useRef(0);
  const activeGridSizeRef = useRef(9);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lobby stats
  const [lobbyStats, setLobbyStats] = useState<LobbyStats>({
    activeMatches: 0,
    waitingPlayers: 0,
    waitingByMode: {},
    liveMatches: []
  });

  const startTimer = (resumeTime?: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (resumeTime !== undefined) setElapsed(resumeTime);
    else setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s: number) => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // Identity & Persist Name + Restore session
  useEffect(() => {
    setMounted(true);
    const savedPid = localStorage.getItem("sudoku_pid") || Math.random().toString(36).substr(2, 9);
    localStorage.setItem("sudoku_pid", savedPid);
    setPlayerId(savedPid);

    const savedName = localStorage.getItem("sudoku_name");
    if (savedName) setPlayerName(savedName);

    // Restore state from sessionStorage
    const savedState = sessionStorage.getItem("sudoku_tab_state");
    if (savedState) {
      const parsed = JSON.parse(savedState);
      setGameState(parsed.gameState);
      setGridMode(parsed.gridMode);
      setMatchId(parsed.matchId);
      setPuzzle(parsed.puzzle);
      setInitialPuzzle(parsed.initialPuzzle);
      setActiveGridSize(parsed.activeGridSize);
      setMyFilled(parsed.myFilled);
      setOpponentFilled(parsed.opponentFilled);
      setTotalEmpty(parsed.totalEmpty);
      setOpponentCells(new Set(parsed.opponentCells));
      setOpponentName(parsed.opponentName);
      totalEmptyRef.current = parsed.totalEmpty;
      activeGridSizeRef.current = parsed.activeGridSize;
      setElapsed(parsed.elapsed);
    }
  }, []);

  useEffect(() => {
    if (playerName !== "Player") localStorage.setItem("sudoku_name", playerName);
  }, [playerName]);

  // Persist Match State (Tab-based)
  useEffect(() => {
    if (gameState === "playing" || gameState === "finished") {
      const state = {
        gameState, matchId, gridMode, puzzle, initialPuzzle, opponentName,
        activeGridSize, elapsed, opponentFilled, totalEmpty, myFilled,
        opponentCells: Array.from(opponentCells)
      };
      sessionStorage.setItem("sudoku_tab_state", JSON.stringify(state));
    } else if (gameState === "idle") {
      sessionStorage.removeItem("sudoku_tab_state");
    }
  }, [gameState, matchId, gridMode, puzzle, initialPuzzle, opponentName, activeGridSize, elapsed, opponentFilled, totalEmpty, opponentCells, myFilled]);


  // Clean up on unmount
  useEffect(() => () => stopTimer(), []);

  /* ── Socket setup (once) ── */
  useEffect(() => {
    const s = io();
    setSocket(s);

    s.on("waiting", () => setGameState("waiting"));

    // Handle Rejoin Restore
    const saved = sessionStorage.getItem("sudoku_tab_state");
    if (saved) {
      const data = JSON.parse(saved);
      const pid = localStorage.getItem("sudoku_pid");
      if (data.matchId && pid) {
        s.emit("rejoinMatch", { matchId: data.matchId, playerId: pid });
      }
    }

    s.on("lobbyStats", (stats: LobbyStats) => {
      setLobbyStats(stats);
    });

    s.on("error", (data: { message: string }) => {
      console.error("Match error:", data.message);
      if (data.message.includes("not found")) {
        setGameState("idle");
        sessionStorage.removeItem("sudoku_tab_state");
      }
    });

    s.on("matchFound", (data: {
      matchId: string; puzzle: string; mode: GridMode; opponentName: string;
      currentProgress?: string[]; opponentFilled?: number
    }) => {
      // Map mode string to numeric size for the UI
      let gs: number = 9;
      if (data.mode === "4") gs = 4;
      if (data.mode === "6") gs = 6;
      if (data.mode === "9" || data.mode === "9expert") gs = 9;

      activeGridSizeRef.current = gs;
      setActiveGridSize(gs);
      setMatchId(data.matchId);

      const arr = data.puzzle.split("");
      setInitialPuzzle([...arr]);

      // If rejoining, use currentProgress from server, otherwise use initial puzzle
      if (data.currentProgress) {
        setPuzzle([...data.currentProgress]);
        setMyFilled(data.currentProgress.filter(c => c !== "-").length - arr.filter(c => c !== "-").length);
      } else {
        setPuzzle([...arr]);
        setMyFilled(0);
      }

      const empty = arr.filter(c => c === "-").length;
      totalEmptyRef.current = empty;
      setTotalEmpty(empty);

      setOpponentFilled(data.opponentFilled || 0);
      setOpponentName(data.opponentName || "Opponent");

      setGameState("playing");

      // Restore elapsed time and opponent cells if rejoining
      let restoredElapsed = 0;
      const saved = sessionStorage.getItem("sudoku_tab_state");
      if (saved && data.currentProgress) {
        const sd = JSON.parse(saved);
        if (sd.matchId === data.matchId) {
          restoredElapsed = sd.elapsed || 0;
          setOpponentCells(new Set(sd.opponentCells || []));
        }
      }

      startTimer(restoredElapsed);
      setWinner(null);
      setWinnerName("");
      setSelectedCell(null);
    });

    s.on("playerProgress", (data: {
      playerId: string;
      filled: number;
      initialFilled: number;
      cellIndex: number;
      cleared: boolean;
    }) => {
      if (data.playerId !== s.id) {
        setOpponentFilled(data.filled - data.initialFilled);
        // Update the set of cells the opponent has answered
        setOpponentCells(prev => {
          const next = new Set(prev);
          if (data.cleared) next.delete(data.cellIndex);
          else next.add(data.cellIndex);
          return next;
        });
      }
    });

    s.on("gameOver", (data: { winner: string; winnerName: string; reason: string }) => {
      stopTimer();
      setWinner(data.winner);
      setWinnerName(data.winnerName);
      setWinReason(data.reason);
      setGameState("finished");
    });

    return () => { s.disconnect(); };
  }, []);

  /* ── Cell click ── */
  const handleCellClick = (index: number) => {
    if (gameState !== "playing" || initialPuzzle[index] !== "-") return;
    setSelectedCell(index);
  };

  /* ── Number / erase input ── */
  const handleInput = useCallback((val: string) => {
    if (selectedCell === null || gameState !== "playing") return;
    if (initialPuzzle[selectedCell] !== "-") return;
    if (puzzle[selectedCell] === val) return;

    const next = [...puzzle];
    next[selectedCell] = val;
    setPuzzle(next);

    const initialFilled = initialPuzzle.filter(c => c !== "-").length;
    setMyFilled(next.filter(c => c !== "-").length - initialFilled);

    socket?.emit("makeMove", {
      matchId,
      index: selectedCell,
      value: val === "-" ? "" : val,
    });
  }, [selectedCell, gameState, initialPuzzle, puzzle, matchId, socket]);

  /* ── Keyboard ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (gameState !== "playing" || selectedCell === null) return;
      const size = activeGridSizeRef.current;
      const max = size * size - 1;

      const validN = size === 6 ? /^[1-6]$/ : /^[1-9]$/;
      if (validN.test(e.key)) { handleInput(e.key); return; }
      if (e.key === "Backspace" || e.key === "Delete") { handleInput("-"); return; }
      if (e.key === "Escape") { setSelectedCell(null); return; }

      let ni = selectedCell;
      if (e.key === "ArrowUp") ni = selectedCell >= size ? selectedCell - size : selectedCell;
      if (e.key === "ArrowDown") ni = selectedCell <= max - size ? selectedCell + size : selectedCell;
      if (e.key === "ArrowLeft") ni = selectedCell % size !== 0 ? selectedCell - 1 : selectedCell;
      if (e.key === "ArrowRight") ni = selectedCell % size !== size - 1 ? selectedCell + 1 : selectedCell;
      if (ni !== selectedCell) { e.preventDefault(); setSelectedCell(ni); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCell, gameState, handleInput]);

  /* ── Find match ── */
  const findMatch = () => socket?.emit("findMatch", {
    mode: gridMode,
    name: playerName,
    playerId: playerId
  });

  /* ── Format elapsed seconds as MM:SS ── */
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const isWinner = winner === socket?.id;
  const numpadNums = activeGridSize === 4 ? ["1", "2", "3", "4"] : activeGridSize === 6 ? ["1", "2", "3", "4", "5", "6"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const gridClass = activeGridSize === 4 ? "sudoku-grid grid-4" : activeGridSize === 6 ? "sudoku-grid grid-6" : "sudoku-grid";
  const numpadClass = activeGridSize === 4 ? "numpad numpad-4" : activeGridSize === 6 ? "numpad numpad-6" : "numpad";
  const eraseSpan = activeGridSize === 4 ? "col-span-4" : activeGridSize === 6 ? "col-span-6" : "col-span-9";

  const findMatchDisplay = gridMode === "9expert" ? "9×9 Expert" : `${gridMode}×${gridMode}`;

  const myPct = totalEmpty ? Math.min(100, Math.max(0, (myFilled / totalEmpty) * 100)) : 0;
  const oppPct = totalEmpty ? Math.min(100, Math.max(0, (opponentFilled / totalEmpty) * 100)) : 0;

  if (!mounted) return <div />;

  return (
    <main>

      {/* ── IDLE ── */}
      {gameState === "idle" && (
        <div className="glass-panel idle-card animate-slide-up">
          <Trophy size={56} className="idle-icon" />
          <h1 className="idle-title">Sudoku Race</h1>

          <div className="player-setup">
            <p className="mode-label">Your Gaming Name</p>
            <input
              className="glass-input"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter name..."
              maxLength={15}
            />
          </div>

          <p className="idle-desc">
            Face off 1v1 — both players get the same puzzle. First to
            completely and correctly fill the board wins!
          </p>

          {/* Mode selection */}
          <div className="mode-section">
            <p className="mode-label">Choose Board Size</p>
            <div className="mode-picker">
              <button
                id="mode-4x4"
                className={`mode-card ${gridMode === "4" ? "active" : ""}`}
                onClick={() => setGridMode("4")}
              >
                {lobbyStats.waitingByMode?.["4"] > 0 && (
                  <div className="mode-waiting-badge">{lobbyStats.waitingByMode["4"]}</div>
                )}
                <div className="mode-card-icon-small">4×4</div>
                <div className="mode-card-title">4 × 4</div>
                <div className="mode-card-sub">Super Fast</div>
                <div className="mode-card-badge">Kids</div>
              </button>

              <button
                id="mode-6x6"
                className={`mode-card ${gridMode === "6" ? "active" : ""}`}
                onClick={() => setGridMode("6")}
              >
                {lobbyStats.waitingByMode?.["6"] > 0 && (
                  <div className="mode-waiting-badge">{lobbyStats.waitingByMode["6"]}</div>
                )}
                <LayoutGrid size={34} className="mode-card-icon" />
                <div className="mode-card-title">6 × 6</div>
                <div className="mode-card-sub">Quick &amp; Fun</div>
                <div className="mode-card-badge">Beginner</div>
              </button>

              <button
                id="mode-9x9"
                className={`mode-card ${gridMode === "9" ? "active" : ""}`}
                onClick={() => setGridMode("9")}
              >
                {lobbyStats.waitingByMode?.["9"] > 0 && (
                  <div className="mode-waiting-badge">{lobbyStats.waitingByMode["9"]}</div>
                )}
                <Grid3X3 size={34} className="mode-card-icon" />
                <div className="mode-card-title">9 × 9</div>
                <div className="mode-card-sub">Classic Fun</div>
                <div className="mode-card-badge">Standard</div>
              </button>

              <button
                id="mode-9expert"
                className={`mode-card ${gridMode === "9expert" ? "active" : ""}`}
                onClick={() => setGridMode("9expert")}
              >
                {lobbyStats.waitingByMode?.["9expert"] > 0 && (
                  <div className="mode-waiting-badge gold">{lobbyStats.waitingByMode["9expert"]}</div>
                )}
                <Trophy size={34} className="mode-card-icon gold" />
                <div className="mode-card-title">Pro</div>
                <div className="mode-card-sub">Pure Chaos</div>
                <div className="mode-card-badge gold">Master</div>
              </button>
            </div>
          </div>

          <button id="find-match-btn" className="btn" onClick={findMatch}>
            <Swords size={20} />
            Find {findMatchDisplay} Match
          </button>

          {/* Live Lobby Stats */}
          <div className="lobby-stats">
            <div className="stat-pill">
              <span className="stat-dot pulse-dot"></span>
              <strong>{lobbyStats.activeMatches}</strong> Live Games
            </div>
            <div className="stat-pill">
              <span className="stat-dot wait-dot"></span>
              <strong>{lobbyStats.waitingPlayers}</strong> Waiting
            </div>
          </div>

          {/* Ongoing Matches List */}
          {lobbyStats.liveMatches.length > 0 && (
            <div className="live-matches-section">
              <h3 className="live-matches-title">Ongoing Matches</h3>
              <div className="live-matches-list">
                {lobbyStats.liveMatches.map((m: MatchStat) => (
                  <div key={m.id} className="live-match-item">
                    <div className="match-mode-tag">{m.mode}×{m.mode}</div>
                    <div className="match-progress-bars">
                      <div className="mini-progress-row">
                        <span className="mini-label">P1</span>
                        <div className="mini-bar-bg">
                          <div className="mini-bar-fill" style={{ width: `${m.p1Progress}%` }} />
                        </div>
                        <span className="mini-pct">{m.p1Progress}%</span>
                      </div>
                      <div className="mini-progress-row">
                        <span className="mini-label">P2</span>
                        <div className="mini-bar-bg">
                          <div className="mini-bar-fill opp" style={{ width: `${m.p2Progress}%` }} />
                        </div>
                        <span className="mini-pct">{m.p2Progress}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── WAITING ── */}
      {gameState === "waiting" && (
        <div className="glass-panel waiting-card animate-slide-up">
          <div className="waiting-icon-wrap">
            <Swords size={30} style={{ color: "#94a3b8" }} />
          </div>
          <h2 className="waiting-title">Looking for Opponent</h2>
          <p className="waiting-mode">Mode: <strong>{gridMode}×{gridMode}</strong></p>
          <p className="waiting-sub">Waiting for a worthy adversary…</p>
          <button className="btn btn-cancel" onClick={() => setGameState("idle")}>
            Cancel
          </button>
        </div>
      )}

      {/* ── PLAYING / FINISHED ── */}
      {(gameState === "playing" || gameState === "finished") && (
        <div className="sudoku-container animate-slide-up">

          {/* Match header */}
          <div className="match-header glass-panel">
            {/* You */}
            <div className="player-info">
              <div className="player-label-row">
                <span className="player-label">YOU</span>
                <span className="player-name-text">{playerName}</span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar progress-bar-you" style={{ width: `${myPct}%` }} />
              </div>
              <div className="progress-row">
                <span className="progress-count-you">{myFilled}/{totalEmpty}</span>
              </div>
            </div>

            {/* VS / Timer */}
            <div className="vs-block">
              <div className="match-timer">{fmt(elapsed)}</div>
              <div className="vs-badge">VS</div>
              <div className="vs-grid-size">{activeGridSize}×{activeGridSize}</div>
            </div>

            {/* Opponent */}
            <div className="player-info" style={{ textAlign: "right" }}>
              <div className="player-label-row opp">
                <span className="player-name-text">{opponentName}</span>
                <span className="player-label">OPP</span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar progress-bar-opp" style={{ width: `${oppPct}%` }} />
              </div>
              <div className="progress-row">
                <span className="progress-count-opp">{opponentFilled}/{totalEmpty}</span>
              </div>
            </div>
          </div>

          {/* Sudoku grid */}
          <div className={gridClass}>
            {puzzle.map((val, idx) => {
              const isFixed = initialPuzzle[idx] !== "-";
              const isSelected = selectedCell === idx;
              // Show opponent indicator on cells the opponent has filled
              const hasOppFill = !isFixed && opponentCells.has(idx);
              return (
                <div
                  key={idx}
                  className={`cell ${isFixed ? "fixed" : "input"} ${isSelected ? "selected" : ""} ${hasOppFill ? "opp-filled" : ""}`}
                  onClick={() => handleCellClick(idx)}
                >
                  {val === "-" ? "" : val}
                </div>
              );
            })}
          </div>

          {/* Numpad */}
          <div className={numpadClass}>
            {numpadNums.map(n => (
              <button key={n} className="numpad-btn" onClick={() => handleInput(n)}>
                {n}
              </button>
            ))}
            <button className={`numpad-btn erase-btn ${eraseSpan}`} onClick={() => handleInput("-")}>
              Erase Cell
            </button>
          </div>
        </div>
      )}

      {/* ── GAME OVER ── */}
      <div className={`game-over-overlay ${gameState === "finished" ? "visible" : ""}`}>
        {gameState === "finished" && (
          <div className="glass-panel game-over-card">
            <div className="game-over-icon">
              {isWinner
                ? <Trophy size={60} style={{ color: "#34d399", filter: "drop-shadow(0 0 14px rgba(16,185,129,0.5))" }} />
                : <XCircle size={60} style={{ color: "#f87171", filter: "drop-shadow(0 0 14px rgba(239,68,68,0.5))" }} />
              }
            </div>
            <h2 className={`game-over-title ${isWinner ? "win" : "lose"}`}>
              {isWinner ? "Victory!" : "Defeat"}
            </h2>
            <p className="game-over-desc">
              <span className="winner-announcement">
                {winnerName} won the race!
              </span>
              <span className="reason-detail">
                {winReason === "opponent_disconnected"
                  ? "Opponent surrendered."
                  : isWinner
                    ? "You solved the puzzle first! 🎉"
                    : "They were faster this time."
                }
              </span>
            </p>
            <button className="btn" onClick={() => { setGameState("idle"); setActiveGridSize(9); setElapsed(0); }}>
              <RotateCcw size={18} />
              Play Again
            </button>
          </div>
        )}
      </div>

    </main>
  );
}
