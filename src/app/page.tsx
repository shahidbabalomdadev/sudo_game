"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Trophy, Swords, XCircle, RotateCcw, AlertTriangle, Grid3X3, LayoutGrid } from "lucide-react";

type GridMode = "6" | "9";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<"idle" | "waiting" | "playing" | "finished">("idle");
  const [gridMode, setGridMode] = useState<GridMode>("9");
  const [matchId, setMatchId] = useState("");
  const [puzzle, setPuzzle] = useState<string[]>(Array(81).fill("-"));
  const [initialPuzzle, setInitialPuzzle] = useState<string[]>(Array(81).fill("-"));
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [activeGridSize, setActiveGridSize] = useState<number>(9); // actual size during a match

  // Progress
  const [myFilled, setMyFilled] = useState(0);
  const [opponentFilled, setOpponentFilled] = useState(0);
  const [totalEmpty, setTotalEmpty] = useState(0);

  // Result
  const [winner, setWinner] = useState<string | null>(null);
  const [winReason, setWinReason] = useState("");

  const totalEmptyRef = useRef(0);
  const activeGridSizeRef = useRef(9);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("waiting", () => {
      setGameState("waiting");
    });

    newSocket.on("matchFound", (data: { matchId: string; puzzle: string; mode: GridMode; player: "p1" | "p2" }) => {
      const gs = parseInt(data.mode) as 6 | 9;
      activeGridSizeRef.current = gs;
      setActiveGridSize(gs);
      setMatchId(data.matchId);
      const puzzleArr = data.puzzle.split("");
      setPuzzle([...puzzleArr]);
      setInitialPuzzle([...puzzleArr]);
      const emptyCount = puzzleArr.filter((c) => c === "-").length;
      totalEmptyRef.current = emptyCount;
      setTotalEmpty(emptyCount);
      setMyFilled(0);
      setOpponentFilled(0);
      setGameState("playing");
      setWinner(null);
      setSelectedCell(null);
    });

    newSocket.on("playerProgress", (data: { playerId: string; filled: number; initialFilled: number }) => {
      if (data.playerId !== newSocket.id) {
        // opponent's filled cells minus the pre-filled ones = cells opponent has answered
        setOpponentFilled(data.filled - data.initialFilled);
      }
    });

    newSocket.on("gameOver", (data: { winner: string; reason: string }) => {
      setWinner(data.winner);
      setWinReason(data.reason);
      setGameState("finished");
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleCellClick = (index: number) => {
    if (gameState !== "playing" || initialPuzzle[index] !== "-") return;
    setSelectedCell(index);
  };

  const handleInput = useCallback((val: string) => {
    if (selectedCell === null || gameState !== "playing") return;
    if (initialPuzzle[selectedCell] !== "-" || puzzle[selectedCell] === val) return;

    const newPuzzle = [...puzzle];
    newPuzzle[selectedCell] = val;
    setPuzzle(newPuzzle);

    const filledCount = newPuzzle.filter(c => c !== "-").length;
    const initialFilled = initialPuzzle.filter(c => c !== "-").length;
    setMyFilled(filledCount - initialFilled);

    socket?.emit("makeMove", {
      matchId,
      index: selectedCell,
      value: val === "-" ? "" : val,
    });
  }, [selectedCell, gameState, initialPuzzle, puzzle, matchId, socket]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== "playing") return;
      const size = activeGridSizeRef.current;
      const maxIndex = size * size - 1;

      if (selectedCell !== null) {
        const validNums = size === 6 ? /^[1-6]$/ : /^[1-9]$/;
        if (validNums.test(e.key)) {
          handleInput(e.key);
        } else if (e.key === "Backspace" || e.key === "Delete") {
          handleInput("-");
        } else if (e.key === "Escape") {
          setSelectedCell(null);
        } else {
          let newIndex = selectedCell;
          switch (e.key) {
            case "ArrowUp": newIndex = selectedCell >= size ? selectedCell - size : selectedCell; break;
            case "ArrowDown": newIndex = selectedCell <= maxIndex - size ? selectedCell + size : selectedCell; break;
            case "ArrowLeft": newIndex = selectedCell % size !== 0 ? selectedCell - 1 : selectedCell; break;
            case "ArrowRight": newIndex = selectedCell % size !== size - 1 ? selectedCell + 1 : selectedCell; break;
          }
          if (newIndex !== selectedCell) setSelectedCell(newIndex);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCell, gameState, handleInput]);

  const findMatch = () => {
    if (socket) {
      socket.emit("findMatch", { mode: gridMode });
    }
  };

  const isWinner = winner === socket?.id;

  // Numpad depends on active grid size during match, or selected mode on idle
  const numpadDigits = activeGridSize === 6
    ? ["1", "2", "3", "4", "5", "6"]
    : ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  // Grid-size-specific CSS class
  const gridClass = activeGridSize === 6 ? "sudoku-grid grid-6" : "sudoku-grid";

  return (
    <main className="flex flex-col items-center justify-center p-4 min-h-screen">

      {/* ── IDLE: Mode Selection ── */}
      {gameState === "idle" && (
        <div className="glass-panel text-center p-10 mt-12 animate-slide-up flex flex-col items-center max-w-lg w-full">
          <Trophy size={60} className="text-blue-500 mb-5 drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
          <h1 className="text-4xl font-extrabold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500 pb-1">
            Sudoku Race
          </h1>
          <p className="text-slate-400 mb-8 leading-relaxed">
            Face off 1v1. Same puzzle, independent solving. First to finish wins!
          </p>

          {/* Mode Picker */}
          <div className="w-full mb-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
              Choose Board Size
            </p>
            <div className="mode-picker">
              <button
                id="mode-6x6"
                className={`mode-card ${gridMode === "6" ? "active" : ""}`}
                onClick={() => setGridMode("6")}
              >
                <LayoutGrid size={36} className={gridMode === "6" ? "text-blue-400" : "text-slate-500"} />
                <div className="mode-card-title">6 × 6</div>
                <div className="mode-card-sub">Quick &amp; Fun</div>
                <div className="mode-card-badge">Beginner</div>
              </button>

              <button
                id="mode-9x9"
                className={`mode-card ${gridMode === "9" ? "active" : ""}`}
                onClick={() => setGridMode("9")}
              >
                <Grid3X3 size={36} className={gridMode === "9" ? "text-blue-400" : "text-slate-500"} />
                <div className="mode-card-title">9 × 9</div>
                <div className="mode-card-sub">Classic Challenge</div>
                <div className="mode-card-badge">Standard</div>
              </button>
            </div>
          </div>

          <button
            id="find-match-btn"
            className="btn text-lg px-8 py-4 w-full justify-center shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:shadow-[0_0_40px_rgba(37,99,235,0.6)]"
            onClick={findMatch}
          >
            <Swords size={22} />
            Find {gridMode}×{gridMode} Match
          </button>
        </div>
      )}

      {/* ── WAITING ── */}
      {gameState === "waiting" && (
        <div className="glass-panel text-center p-12 mt-20 animate-slide-up">
          <div className="pulse inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-800/50 border border-slate-700 mb-6">
            <Swords size={32} className="text-slate-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Looking for Opponent</h2>
          <p className="text-slate-400 mb-1">Mode: <span className="text-blue-400 font-semibold">{gridMode}×{gridMode}</span></p>
          <p className="text-slate-500 text-sm">Waiting for a worthy adversary…</p>
          <button className="btn mt-6 text-sm px-6 py-2 !bg-slate-700 hover:!bg-slate-600 !shadow-none" onClick={() => setGameState("idle")}>
            Cancel
          </button>
        </div>
      )}

      {/* ── PLAYING / FINISHED ── */}
      {(gameState === "playing" || gameState === "finished") && (
        <div className="sudoku-container animate-slide-up">

          {/* Header */}
          <div className="match-header">
            <div className="player-info w-2/5">
              <div className="player-name">You</div>
              <div className="flex flex-col w-full">
                <div className="flex justify-between text-sm mb-1 text-slate-300">
                  <span>Progress</span>
                  <span className="font-mono text-blue-400">{myFilled} / {totalEmpty}</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar" style={{ width: `${Math.min(100, Math.max(0, totalEmpty ? (myFilled / totalEmpty) * 100 : 0))}%` }}></div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className="vs-badge">VS</div>
              <div className="text-xs text-slate-500 font-mono">{activeGridSize}×{activeGridSize}</div>
            </div>

            <div className="player-info w-2/5 items-end text-right">
              <div className="player-name">Opponent</div>
              <div className="flex flex-col w-full">
                <div className="flex justify-between text-sm mb-1 text-slate-300">
                  <span className="font-mono text-red-400">{opponentFilled} / {totalEmpty}</span>
                  <span>Progress</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar opponent" style={{ float: "right", width: `${Math.min(100, Math.max(0, totalEmpty ? (opponentFilled / totalEmpty) * 100 : 0))}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className={gridClass}>
            {puzzle.map((val, idx) => {
              const isFixed = initialPuzzle[idx] !== "-";
              const isSelected = selectedCell === idx;
              return (
                <div
                  key={idx}
                  className={`cell ${isFixed ? "fixed" : "input"} ${isSelected ? "selected" : ""}`}
                  onClick={() => handleCellClick(idx)}
                >
                  {val === "-" ? "" : val}
                </div>
              );
            })}
          </div>

          {/* Numpad */}
          <div className={`numpad ${activeGridSize === 6 ? "numpad-6" : ""}`}>
            {numpadDigits.map((num) => (
              <button key={num} className="numpad-btn" onClick={() => handleInput(num)}>
                {num}
              </button>
            ))}
            <button
              className={`numpad-btn erase-btn ${activeGridSize === 6 ? "col-span-6" : "col-span-9"}`}
              onClick={() => handleInput("-")}
            >
              Erase Cell
            </button>
          </div>
        </div>
      )}

      {/* ── GAME OVER OVERLAY ── */}
      <div className={`game-over-overlay ${gameState === "finished" ? "visible" : ""}`}>
        {gameState === "finished" && (
          <div className="glass-panel game-over-card">
            {isWinner ? (
              <Trophy size={64} className="mx-auto text-emerald-400 mb-6 drop-shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
            ) : (
              <XCircle size={64} className="mx-auto text-red-400 mb-6 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
            )}
            <h2 className={`game-over-title ${isWinner ? "win" : "lose"}`}>
              {isWinner ? "Victory!" : "Defeat"}
            </h2>
            <p className="game-over-desc">
              {winReason === "opponent_disconnected" ? (
                <span className="flex items-center justify-center gap-2">
                  <AlertTriangle size={18} className="text-yellow-500" /> Your opponent fled the match.
                </span>
              ) : isWinner ? "You solved the puzzle first!" : "Your opponent finished before you."}
            </p>
            <button className="btn w-full justify-center" onClick={() => { setGameState("idle"); setActiveGridSize(9); }}>
              <RotateCcw size={20} />
              Play Again
            </button>
          </div>
        )}
      </div>

    </main>
  );
}
