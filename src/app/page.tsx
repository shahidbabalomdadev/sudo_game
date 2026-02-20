"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Trophy, Swords, XCircle, RotateCcw,
  AlertTriangle, Grid3X3, LayoutGrid
} from "lucide-react";

type GridMode = "4" | "6" | "9" | "9expert";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
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
  const [winReason, setWinReason] = useState("");

  const totalEmptyRef = useRef(0);
  const activeGridSizeRef = useRef(9);

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Lobby stats
  const [lobbyStats, setLobbyStats] = useState({
    activeMatches: 0,
    waitingPlayers: 0,
    liveMatches: [] as { id: string, mode: string, p1Progress: number, p2Progress: number }[]
  });

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // Clean up on unmount
  useEffect(() => () => stopTimer(), []);

  /* ── Socket setup (once) ── */
  useEffect(() => {
    const s = io();
    setSocket(s);

    s.on("waiting", () => setGameState("waiting"));

    s.on("lobbyStats", (stats: any) => {
      setLobbyStats(stats);
    });

    s.on("matchFound", (data: { matchId: string; puzzle: string; mode: GridMode }) => {
      // Map mode string to numeric size for the UI
      let gs: number = 9;
      if (data.mode === "4") gs = 4;
      if (data.mode === "6") gs = 6;
      if (data.mode === "9" || data.mode === "9expert") gs = 9;

      activeGridSizeRef.current = gs;
      setActiveGridSize(gs);
      setMatchId(data.matchId);
      const arr = data.puzzle.split("");
      setPuzzle([...arr]);
      setInitialPuzzle([...arr]);
      const empty = arr.filter(c => c === "-").length;
      totalEmptyRef.current = empty;
      setTotalEmpty(empty);
      setMyFilled(0);
      setOpponentFilled(0);
      setOpponentCells(new Set());
      setGameState("playing");
      startTimer();
      setWinner(null);
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

    s.on("gameOver", (data: { winner: string; reason: string }) => {
      stopTimer();
      setWinner(data.winner);
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
  const findMatch = () => socket?.emit("findMatch", { mode: gridMode });

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

  return (
    <main>

      {/* ── IDLE ── */}
      {gameState === "idle" && (
        <div className="glass-panel idle-card animate-slide-up">
          <Trophy size={56} className="idle-icon" />
          <h1 className="idle-title">Sudoku Race</h1>
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
                {lobbyStats.liveMatches.map((m: any) => (
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
          <div className="match-header">
            {/* You */}
            <div className="player-info">
              <div className="player-name">You</div>
              <div className="progress-row">
                <span>Progress</span>
                <span className="progress-count-you">{myFilled}/{totalEmpty}</span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar progress-bar-you" style={{ width: `${myPct}%` }} />
              </div>
            </div>

            {/* VS / Timer */}
            <div className="vs-block">
              <div className="vs-badge">VS</div>
              <div className="match-timer">{fmt(elapsed)}</div>
              <div className="vs-grid-size">{activeGridSize}×{activeGridSize}</div>
            </div>

            {/* Opponent */}
            <div className="player-info" style={{ textAlign: "right" }}>
              <div className="player-name">Opponent</div>
              <div className="progress-row">
                <span className="progress-count-opp">{opponentFilled}/{totalEmpty}</span>
                <span>Progress</span>
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar progress-bar-opp" style={{ width: `${oppPct}%` }} />
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
              {winReason === "opponent_disconnected"
                ? <><AlertTriangle size={18} style={{ color: "#f59e0b" }} /> Your opponent fled the match.</>
                : isWinner
                  ? "You solved the puzzle first! 🎉"
                  : "Your opponent finished before you."
              }
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
