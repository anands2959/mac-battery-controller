import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";



interface BatteryStatus {
  percentage: number;
  remaining_time: string;
  charging_status: string;
  discharging_status: string;
  maintain_percentage: number | null;
  is_discharging_active: boolean;
  is_top_up_active: boolean;
}



function App() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);

  const [limit, setLimit] = useState(80);
  const [percentage, setPercentage] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState("");
  const [chargingStatus, setChargingStatus] = useState("enabled");
  const [dischargingStatus, setDischargingStatus] = useState("not discharging");
  const [isDischargingActive, setIsDischargingActive] = useState(false);
  const [isTopUpActive, setIsTopUpActive] = useState(false);
  const [isActive, setIsActive] = useState(false);




  const [togglingDischarge, setTogglingDischarge] = useState(false);
  const [togglingTopUp, setTogglingTopUp] = useState(false);

  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const userLimit = useRef(80);

 

  const checkInstalled = useCallback(async (): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("is_installed");
      setInstalled(ok);
      return ok;
    } catch {
      setInstalled(false);
      return false;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await invoke<BatteryStatus>("get_status");
      setPercentage(s.percentage);
      setRemainingTime(s.remaining_time);
      setChargingStatus(s.charging_status);
      setDischargingStatus(s.discharging_status);
      setIsDischargingActive(s.is_discharging_active);
      setIsTopUpActive(s.is_top_up_active);
      if (s.maintain_percentage !== null && s.maintain_percentage < 100) {
        setLimit(s.maintain_percentage);
        userLimit.current = s.maintain_percentage;
        setIsActive(true);
      } else {
        setIsActive(false);
      }
    } catch (err) {
      console.error("get_status failed:", err);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await invoke("install_tools");
      const ok = await checkInstalled();
      if (ok) {
        await fetchStatus();
      } else {
        console.error("Battery Control helper installation: Verification failed — please retry.");
      }
    } catch (err: any) {
      console.error("Battery Control helper installation failed:", err);
    } finally {
      setInstalling(false);
    }
  }, [checkInstalled, fetchStatus]);






  useEffect(() => {
    checkInstalled().then(async (ok) => {
      if (ok) {
        await fetchStatus();
      } else {

        
        handleInstall();
      }
    });

    const id = setInterval(async () => {
      const ok = await invoke<boolean>("is_installed").catch(() => false);
      setInstalled(ok);
      if (ok) fetchStatus();
    }, 4_000);

    return () => clearInterval(id);


  }, []);





  const updateLimit = async (val: number) => {
    try {
      await invoke("set_limit", { limit: val });
      userLimit.current = val;
      await fetchStatus();
    } catch (err) {
      console.error("set_limit failed:", err);
    }
  };

  const isCurrentlyDischarging = isDischargingActive;
  const isCurrentlyToppingUp = isTopUpActive;



  const canDischarge = !isCurrentlyToppingUp && (isCurrentlyDischarging || (percentage !== null && percentage > limit));
  const canTopUp = !isCurrentlyDischarging && (isCurrentlyToppingUp || (percentage !== null && percentage < 99 && limit < 99));

  const handleDischarge = async () => {
    if (!canDischarge || togglingDischarge) return;
    setTogglingDischarge(true);
    try {
      if (isCurrentlyDischarging) {
        await invoke("set_limit", { limit });
      } else {
        await invoke("discharge", { limit });
      }


      await new Promise((r) => setTimeout(r, 450));
      await fetchStatus();
    } catch (err) {
      console.error("discharge toggle failed:", err);
    } finally {
      setTogglingDischarge(false);
    }
  };

  const handleTopUp = async () => {
    if (!canTopUp || togglingTopUp) return;
    setTogglingTopUp(true);
    try {
      if (isCurrentlyToppingUp) {
        await invoke("set_limit", { limit });
      } else {
        await invoke("top_up");
      }


      await new Promise((r) => setTimeout(r, 450));
      await fetchStatus();
    } catch (err) {
      console.error("top_up toggle failed:", err);
    } finally {
      setTogglingTopUp(false);
    }
  };




  const calcValue = (clientX: number): number | undefined => {
    if (!trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = Math.round(50 + frac * 50);
    setLimit(v);
    return v;
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    if (!trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.round(50 + frac * 50);
    setLimit(v);
  }, []);

  const onMouseUp = useCallback(
    (e: MouseEvent) => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (!trackRef.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const v = Math.round(50 + frac * 50);
      setLimit(v);
      updateLimit(v);
      setIsActive(true);
    },


    [onMouseMove]
  );

  const onTrackMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    calcValue(e.clientX);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging.current || !e.touches[0]) return;
    if (!trackRef.current) return;
    const r = trackRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.touches[0].clientX - r.left) / r.width));
    setLimit(Math.round(50 + frac * 50));
  }, []);

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      isDragging.current = false;
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      if (e.changedTouches[0] && trackRef.current) {
        const r = trackRef.current.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (e.changedTouches[0].clientX - r.left) / r.width));
        const v = Math.round(50 + frac * 50);
        setLimit(v);
        updateLimit(v);
        setIsActive(true);
      }
    },


    [onTouchMove]
  );

  const onTrackTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    if (e.touches[0]) calcValue(e.touches[0].clientX);
    document.addEventListener("touchmove", onTouchMove);
    document.addEventListener("touchend", onTouchEnd);
  };

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [onMouseMove, onMouseUp, onTouchMove, onTouchEnd]);




  const pct = ((limit - 50) / 50) * 100;


  if (installed === null || (installed === false && installing)) {
    return (
      <div className="w-full h-full p-3 select-none flex items-center justify-center">
        <div className="w-full h-full bg-[#141416] border border-white/10 rounded-[18px] flex flex-col items-center justify-center gap-2 shadow-lg shadow-black/40">


          <div className="w-5 h-5 border-2 border-white/10 border-t-blue-400 rounded-full animate-spin" />
          <span className="text-white/60 text-[12px] font-semibold tracking-wide">
            Installing battery tools…
          </span>
        </div>
      </div>
    );
  }


  if (installed === false) {
    return (
      <div className="w-full h-full p-3 select-none flex items-center justify-center">
        <div className="w-full h-full bg-[#141416] border border-white/10 rounded-[18px] p-5 flex flex-col justify-between shadow-lg shadow-black/40">
          <div className="flex items-center justify-between gap-3 h-full">
            <div className="flex flex-col gap-1">
              <span className="text-white font-bold text-[13px] tracking-tight">
                Battery Helper Required
              </span>
              <span className="text-[#8e8e93] text-[11px] font-medium leading-tight max-w-[280px]">
                SMC helper needed to control charging.
              </span>
            </div>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="bg-[#0a84ff] hover:bg-[#409cff] disabled:opacity-40 text-white font-extrabold text-[12px] px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer active:scale-95 shrink-0 shadow-lg shadow-blue-500/25"
            >
              {installing ? "Installing…" : "Install"}
            </button>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="w-full h-full p-1 select-none flex items-center justify-center">
      <div className="w-full h-full bg-[#141416] border border-white/10 rounded-[18px] px-4 py-2 flex flex-col justify-between relative overflow-hidden">

        <div className="absolute -top-10 -right-10 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />


        <div className="flex items-center justify-between z-10">


          
            <div className="relative flex items-center">

              <div className="w-9 h-5 border border-white/20 rounded-[5px] p-[1.5px] flex items-center relative bg-white/5">

                <div
                  style={{ width: `${percentage !== null ? percentage : 0}%` }}
                  className={`h-full rounded-[2px] transition-all duration-300 ${isCurrentlyToppingUp
                    ? "bg-gradient-to-r from-emerald-400 to-green-500 shadow-[0_0_8px_rgba(52,211,153,0.5)] animate-pulse"
                    : isCurrentlyDischarging
                      ? "bg-gradient-to-r from-rose-400 to-red-500 shadow-[0_0_8px_rgba(251,113,133,0.5)]"
                      : "bg-gradient-to-r from-blue-400 to-indigo-500 shadow-[0_0_8px_rgba(96,165,250,0.5)]"
                    }`}
                />
                
                <div className="absolute -right-[3px] top-[5px] w-[2px] h-[8px] bg-white/20 rounded-r-[1px]" />
              </div>


              {isCurrentlyToppingUp && (
                <div className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white rounded-full p-0.5 shadow-md">
                  <svg width="6" height="6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              )}
            </div>

            
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <span className="text-white font-extrabold text-[14px] tracking-tight">
                  Limit: {limit}%
                </span>
                {percentage !== null && (
                  <span className="text-[#8e8e93] text-[11px] font-semibold">
                    ({percentage}%)
                  </span>
                )}
              </div>
              {percentage !== null && (
                <span className="text-[#8e8e93] text-[10px] font-semibold leading-none">
                  {isCurrentlyToppingUp
                    ? "Topping up..."
                    : isCurrentlyDischarging
                      ? "Discharging..."
                      : remainingTime
                        ? `${remainingTime} remaining`
                        : "Plugged in"}
                </span>
              )}
            </div>
          </div>

          
          <div className="flex items-center gap-2">

            
            <button
              onClick={handleDischarge}
              disabled={!canDischarge || togglingDischarge}
              className={`flex items-center gap-1.5 border px-2 py-1 rounded-full transition-all duration-200 cursor-pointer text-[12px] font-bold ${isCurrentlyDischarging
                ? "bg-gradient-to-r from-rose-500 to-red-600 border-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-glow-red"
                : !canDischarge
                  ? "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
                  : "border-white/10 bg-white/5 hover:bg-white/10 text-white/90 hover:border-white/20 active:scale-95"
                }`}
            >
              {togglingDischarge ? (
                <div className="w-3.5 h-3.5 border-2 border-white/25 border-t-white rounded-full animate-spin" />
              ) : isCurrentlyDischarging ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span>Discharge</span>
                </>
              )}
            </button>

            
            <button
              onClick={handleTopUp}
              disabled={!canTopUp || togglingTopUp}
              className={`flex items-center gap-1.5 border px-2 py-1 rounded-full transition-all duration-200 cursor-pointer text-[12px] font-bold ${isCurrentlyToppingUp
                ? "bg-gradient-to-r from-emerald-500 to-green-600 border-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)] animate-glow-green"
                : !canTopUp
                  ? "border-white/10 bg-white/[0.02] text-white/30 cursor-not-allowed"
                  : "border-white/10 bg-white/5 hover:bg-white/10 text-white/90 hover:border-white/20 active:scale-95"
                }`}
            >
              {togglingTopUp ? (
                <div className="w-3.5 h-3.5 border-2 border-white/25 border-t-white rounded-full animate-spin" />
              ) : isCurrentlyToppingUp ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="16" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span>Top Up</span>
                </>
              )}
            </button>
          </div>
        </div>

        
        <div className="flex flex-col gap-1.5 z-10">
        
          <div
            ref={trackRef}
            onMouseDown={onTrackMouseDown}
            onTouchStart={onTrackTouchStart}
            className="relative w-full cursor-pointer flex items-center py-2 group mt-1"
          >

            <div className="absolute top-[6px] left-0 right-0 h-[4px] bg-[#2c2c2e]/70 rounded-full" />
            <div
              style={{ width: `${pct}%` }}
              className="absolute top-[6px] left-0 h-[4px] bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full shadow-[0_0_8px_rgba(96,165,250,0.4)] transition-[width] duration-75"
            />
            <div
              style={{ left: `${pct}%` }}
              className="absolute top-[0px] -ml-[7.5px] w-[15px] h-[15px] bg-white rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.6)] border border-neutral-300 transition-transform duration-75 group-hover:scale-110 active:scale-95 flex items-center justify-center"
            >
              <div className="w-[6px] h-[6px] bg-neutral-300 rounded-full" />
            </div>
          </div>



          <div className="flex items-center justify-between text-[9px] font-bold tracking-wider uppercase">
            <span className="text-[#555] font-extrabold">50%</span>
            <span
              className={`normal-case tracking-normal font-semibold text-[10px] ${isCurrentlyDischarging
                ? "text-rose-400 font-bold"
                : isCurrentlyToppingUp
                  ? "text-emerald-400 font-bold"
                  : !isActive
                    ? "text-blue-400 font-bold"
                    : "text-[#8e8e93]"
                }`}
            >
              {isCurrentlyDischarging
                ? "Forcing discharge to target"
                : isCurrentlyToppingUp
                  ? "Top-up charging (to 100%)"
                  : !isActive
                    ? "Limit Inactive - Drag slider to set"
                    : chargingStatus === "disabled"
                      ? "Charging paused (limit reached)"
                      : dischargingStatus === "discharging"
                        ? "Running on battery"
                        : "Charging to limit"}
            </span>
            <span className="text-[#555] font-extrabold">100%</span>
          </div>
        </div>
      </div>
  );
}

export default App;
