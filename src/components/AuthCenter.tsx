import { useState, useEffect, FormEvent } from "react";
import { getCurrentUser, setCurrentUser, getRegisteredProfiles, saveRegisteredProfiles, User, UserProfile } from "../utils/auth";
import { sound } from "../utils/audio";
import { LogIn, Key, Mail, UserPlus, Eye, EyeOff, Check, LogOut, ArrowRight, Sparkles, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { reconcileOnStartup, triggerPushSync } from "../utils/sync";

interface AuthCenterProps {
  onSessionChange: (user: User | null) => void;
}

export function AuthCenter({ onSessionChange }: AuthCenterProps) {
  const [currentUser, setLocalCurrentUser] = useState<User | null>(null);
  const [isRegister, setIsRegister] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Sync state with disk
  useEffect(() => {
    setLocalCurrentUser(getCurrentUser());
  }, []);

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const targetEmail = email.trim();
    const targetPassword = password;

    if (!targetEmail) {
      sound.playIncorrect();
      setErrorMsg("Email is required.");
      return;
    }
    if (!targetPassword || targetPassword.length < 4) {
      sound.playIncorrect();
      setErrorMsg("Password must be at least 4 characters long.");
      return;
    }

    setIsLoading(true);
    try {
      const profiles = await getRegisteredProfiles();
      let loggedUser: User | null = null;
      let isOfflineMode = false;

      if (isRegister) {
        // Handle Registration
        if (targetPassword !== confirmPassword) {
          sound.playIncorrect();
          setErrorMsg("Passwords do not match.");
          return;
        }

        try {
          const resp = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: targetEmail, password: targetPassword })
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.success) {
              loggedUser = data.data;
            }
          } else {
            const errJson = await resp.json().catch(() => ({}));
            setErrorMsg(errJson.error || "Backend registration failed.");
            sound.playIncorrect();
            return;
          }
        } catch (netErr) {
          console.warn("Backend registration unreachable. Falling back directly to offline mode...", netErr);
          isOfflineMode = true;
        }

        if (isOfflineMode) {
          const exists = profiles.some(p => p.email.toLowerCase() === targetEmail.toLowerCase());
          if (exists) {
            sound.playIncorrect();
            setErrorMsg("This email address is already registered.");
            return;
          }

          const newProfile: UserProfile = {
            email: targetEmail,
            passwordHash: targetPassword, // Simple plaintext-matching as requested by user
            joined: Date.now()
          };

          const updatedProfiles = [...profiles, newProfile];
          await saveRegisteredProfiles(updatedProfiles);
          loggedUser = { email: newProfile.email, joined: newProfile.joined };
        }
        
        sound.playCorrect();
        setSuccessMsg("Registration successful! Logging you in...");

        // Auto Log In
        setTimeout(async () => {
          if (loggedUser) {
            setCurrentUser(loggedUser);
            setLocalCurrentUser(loggedUser);
            onSessionChange(loggedUser);

            if (!isOfflineMode) {
              await triggerPushSync(loggedUser.email);
            }
          }
          // Clean inputs
          setEmail("");
          setPassword("");
          setConfirmPassword("");
          setSuccessMsg("");
        }, 1200);

      } else {
        // Handle Log In
        try {
          const resp = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: targetEmail, password: targetPassword })
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.success) {
              loggedUser = data.data;
            }
          } else if (resp.status === 401 || resp.status === 400) {
            const errJson = await resp.json().catch(() => ({}));
            sound.playIncorrect();
            setErrorMsg(errJson.error || "Invalid email or password.");
            return;
          } else {
            throw new Error(`HTTP error ${resp.status}`);
          }
        } catch (netErr) {
          console.warn("Backend login unreachable. Trying local matched credentials...", netErr);
          isOfflineMode = true;
        }

        if (isOfflineMode) {
          const matched = profiles.find(p => p.email.toLowerCase() === targetEmail.toLowerCase() && p.passwordHash === targetPassword);
          if (!matched) {
            sound.playIncorrect();
            setErrorMsg("Invalid email or password.");
            return;
          }
          loggedUser = { email: matched.email, joined: matched.joined };
        }

        if (loggedUser) {
          sound.playCorrect();

          if (!isOfflineMode) {
            // Set the storage identity first so IndexedDB reads/writes use the right user scope,
            // then pull before mounting the rest of the app. This avoids a fresh browser
            // initializing default local data and pushing it over the server copy.
            setCurrentUser(loggedUser);
            await reconcileOnStartup(loggedUser.email);
          } else {
            setCurrentUser(loggedUser);
          }

          setLocalCurrentUser(loggedUser);
          onSessionChange(loggedUser);

          // Clean inputs
          setEmail("");
          setPassword("");
          setConfirmPassword("");
        }
      }
    } catch (err) {
      sound.playIncorrect();
      setErrorMsg("Failed to authenticate. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    sound.playTick();
    setCurrentUser(null);
    setLocalCurrentUser(null);
    onSessionChange(null);
    setErrorMsg("");
    setSuccessMsg("");
  };

  return (
    <div className="bg-white border-2 border-zinc-900 rounded-[32px] p-5 sm:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden" id="auth-center-widget">
      
      {/* Decorative accent background tabs */}
      <div className="absolute top-0 right-0 py-1.5 px-4 bg-indigo-600 text-white border-l-2 border-b-2 border-zinc-900 font-black text-[10px] md:text-xs uppercase tracking-wider rounded-bl-2xl">
        {currentUser ? "ACTIVE SESSION" : "ACCESS PANEL"}
      </div>

      <div className="flex flex-col md:flex-row items-stretch gap-6">
        
        {/* LEFT COLUMN: BRAND PROMO OR CURRENT ACCOUNT STATE */}
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-5 bg-zinc-50 border-2 border-zinc-900 rounded-2xl min-h-[180px] relative">
          {currentUser ? (
            <div className="flex flex-col h-full justify-between gap-4">
              <div>
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">Signed In Student</span>
                <h3 className="text-xl font-black text-zinc-900 mt-1 break-words">{currentUser.email}</h3>
                <p className="text-xs text-zinc-500 font-bold mt-1 uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" /> Isolated user-level progress tracking active
                </p>
                <p className="text-[10px] text-zinc-400 font-bold mt-2 font-mono uppercase">
                  Joined: {new Date(currentUser.joined).toLocaleDateString()}
                </p>
              </div>

              <div className="pt-3 border-t border-dashed border-zinc-200">
                <button
                  onClick={handleLogout}
                  className="w-full sm:w-auto py-2.5 px-4 bg-red-100 hover:bg-red-200 text-red-700 font-black text-xs uppercase tracking-wider rounded-xl border border-red-300 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <LogOut className="h-4 w-4" /> Sign Out Account
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full justify-between gap-4">
              <div>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Sparkles className="h-4 w-4 text-indigo-500 animate-spin" />
                  <span className="text-[10px] font-black uppercase tracking-wider">Kiroku ID</span>
                </div>
                <h3 className="text-lg font-black text-zinc-900 mt-1 uppercase">Save Progress Offline </h3>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  Register or sign in with any simple email & password. Separate your study active cards, streak counts, custom Anki Decks, and Speed sheets completely!
                </p>
              </div>

              <div className="text-[9px] font-black text-zinc-400 bg-zinc-150 border border-zinc-300 py-1.5 px-3 rounded-lg flex items-center gap-1.5 select-none uppercase">
                🔒 Safe Local Profile Sync (No Firebase or Cloud APIs)
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: INTERACTIVE FORM ACTIONS */}
        {!currentUser && (
          <div className="flex-1">
            {/* Form Toggle buttons */}
            <div className="flex bg-zinc-100 border-2 border-zinc-900 p-1 rounded-xl mb-4 self-start">
              <button
                type="button"
                onClick={() => { sound.playTick(); setIsRegister(false); setErrorMsg(""); setSuccessMsg(""); }}
                className={`flex-1 py-1 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-transform ${!isRegister ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { sound.playTick(); setIsRegister(true); setErrorMsg(""); setSuccessMsg(""); }}
                className={`flex-1 py-1 px-3 text-[10px] font-black uppercase tracking-wider rounded-lg transition-transform ${isRegister ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-indigo-605 text-zinc-650'}`}
              >
                Register
              </button>
            </div>

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              {/* Email Address */}
              <div>
                <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block mb-1">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email..."
                    className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-10 pr-4 text-xs font-bold focus:outline-none placeholder:text-zinc-300 text-zinc-900"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block mb-1">Password</label>
                <div className="relative">
                  <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 4 chars..."
                    className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-10 pr-10 text-xs font-bold focus:outline-none placeholder:text-zinc-300 text-zinc-900"
                  />
                  <button
                    type="button"
                    onClick={() => { sound.playTick(); setShowPassword(!showPassword); }}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password (only on Register) */}
              {isRegister && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider block mb-1">Confirm Password</label>
                  <div className="relative">
                    <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat password..."
                      className="w-full bg-white border-2 border-zinc-900 rounded-xl py-2 pl-10 pr-4 text-xs font-bold focus:outline-none placeholder:text-zinc-300 text-zinc-900"
                    />
                  </div>
                </motion.div>
              )}

              {/* Msg/Alert logs */}
              {errorMsg && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold rounded-lg leading-snug">
                  ⚠️ {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-lg flex items-center gap-1.5 leading-none">
                  <Check className="h-3.5 w-3.5" /> {successMsg}
                </div>
              )}

              {/* Submit Buttons */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-2.5 px-4 font-black text-xs uppercase tracking-wider rounded-xl border-2 border-zinc-900 transition-all cursor-pointer shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 flex items-center justify-center gap-2 ${
                  isRegister ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-zinc-900 hover:bg-zinc-800 text-white'
                } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isLoading ? (
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : isRegister ? (
                  <>
                    <UserPlus className="h-4 w-4" /> Create Student Account
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Sign In securely
                  </>
                )}
              </button>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
