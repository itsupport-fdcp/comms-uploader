"use client";

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  UploadCloud, 
  CheckCircle, 
  Copy, 
  Link as LinkIcon, 
  Loader2, 
  Image as ImageIcon, 
  Lock, 
  Mail, 
  LogOut, 
  User as UserIcon,
  ShieldCheck,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import { auth } from '../firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged
} from 'firebase/auth';
import type { User } from 'firebase/auth';

function compressImageToWebP(file: File): Promise<File> {
  return new Promise((resolve) => {
    // Check if the browser supports FileReader
    if (!window.FileReader) {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Setup canvas
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDimension = 2560;

        // Proportional downscaling if image is huge
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file); // Fallback to original file if context is unavailable
          return;
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Adaptive WebP compression targeting under 1 MB
        let quality = 0.85;
        const targetSize = 1 * 1024 * 1024; // 1 MB

        const attemptCompression = (q: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file); // Fallback
                return;
              }

              if (blob.size > targetSize && q > 0.4) {
                // If it is > 1MB and quality is high enough, try lower quality
                attemptCompression(q - 0.15);
              } else if (blob.size > targetSize && q <= 0.4 && canvas.width > 1280) {
                // If it is still too large, downscale resolution by 25% and retry
                canvas.width = Math.round(canvas.width * 0.75);
                canvas.height = Math.round(canvas.height * 0.75);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                attemptCompression(0.7); // Reset quality loop at new resolution
              } else {
                // Succeeded or hit absolute floor, build the new File object
                const dotIndex = file.name.lastIndexOf('.');
                const originalNameWithoutExt = dotIndex !== -1 ? file.name.substring(0, dotIndex) : file.name;
                const newFilename = `${originalNameWithoutExt}.webp`;
                
                const compressedFile = new File([blob], newFilename, {
                  type: 'image/webp',
                  lastModified: Date.now(),
                });
                
                resolve(compressedFile);
              }
            },
            'image/webp',
            q
          );
        };

        attemptCompression(quality);
      };

      img.onerror = () => {
        resolve(file); // Fallback on image error
      };

      img.src = event.target?.result as string;
    };

    reader.onerror = () => {
      resolve(file); // Fallback on reader error
    };

    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploads, setUploads] = useState<any[]>([]);

  // Monitor Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);



  

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

    // Form validation
    if (!email || !password) {
      setAuthError('Please fill in all fields.');
      return;
    }

    if (authMode === 'signup' && password !== confirmPassword) {
      setAuthError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    setIsLoading(true);

    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        setAuthSuccess('Account created successfully!');
        // Small delay to allow the user to see success
        setTimeout(() => {
          setAuthSuccess(null);
        }, 3000);
      }
    } catch (err: any) {
      console.error(err);
      let message = 'An error occurred during authentication.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        message = 'Invalid email or password.';
      } else if (err.code === 'auth/email-already-in-use') {
        message = 'This email is already in use.';
      } else if (err.code === 'auth/invalid-email') {
        message = 'Please enter a valid email address.';
      } else if (err.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters.';
      } else if (err.message) {
        message = err.message;
      }
      setAuthError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // Reset inputs
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setAuthError(null);
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user) return; // Prevent uploads if not authenticated
    setIsUploading(true);
    
    for (const file of acceptedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        // POST to our secure serverless endpoint
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
          }),
        });
        
        const presignResponse = await presignRes.json();
        
        if (response.success) {
          setUploads(prev => [{
            url: response.url,
            filename: response.filename,
            originalName: file.name
          }, ...prev]);
        } else {
          console.error("Upload failed:", response.error);
          setAuthError(`Upload failed: ${response.error}`);
          setTimeout(() => setAuthError(null), 5000);
          continue;
        }

        // Step 3: Successfully uploaded
        setUploads(prev => [{
          url: publicUrl,
          filename: filename,
          originalName: file.name
        }, ...prev]);
      } catch (error: any) {
        console.error("Error invoking upload:", error);
        setAuthError(`Error uploading file: ${error.message || error}`);
        setTimeout(() => setAuthError(null), 5000);
      }
    }
    
    setIsUploading(false);
    setStatusMessage(null);
  }, [user]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    disabled: !user 
  });

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<'newline' | 'comma' | null>(null);

  //copy fixesdsadsadasda
  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    // Avoid scrolling to bottom
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textArea);
  };

  const copyToClipboard = (url: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url);
    } else {
      fallbackCopy(url);
    }
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const copyAllLinks = (format: 'newline' | 'comma') => {
    if (uploads.length === 0) return;
    const urls = uploads.map(u => u.url);
    const text = format === 'newline' ? urls.join('\n') : urls.join(', ');
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
    
    setCopiedAll(format);
    setTimeout(() => setCopiedAll(null), 2000);
  };

  // Loading state when checking authentication (Cohesive Light Theme)
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4 animate-fade-in">
        <div className="relative flex items-center justify-center">
          <div className="h-16 w-16 rounded-full border-4 border-brand-500/10 border-t-brand-500 animate-spin"></div>
          <ShieldCheck className="h-8 w-8 text-brand-500 absolute animate-pulse" />
        </div>
        <p className="text-slate-500 font-medium tracking-wide animate-pulse">Securing your workspace...</p>
      </div>
    );
  }

  // Not authenticated screen (Redesigned Minimalist Light Theme)
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Modern, Subtle Light Blurs */}
        <div className="absolute -top-[10%] -right-[10%] w-[500px] h-[500px] rounded-full bg-brand-100/30 blur-[120px] pointer-events-none animate-pulse-slow" />
        <div className="absolute -bottom-[10%] -left-[10%] w-[500px] h-[500px] rounded-full bg-indigo-50/40 blur-[120px] pointer-events-none animate-float-1" />

        {/* Minimalist Login Card */}
        <div className="w-full max-w-md bg-white border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.06)] rounded-[32px] p-8 md:p-10 relative z-10 transition-all duration-300 hover:shadow-[0_20px_60px_rgba(15,23,42,0.09)] group/card animate-slide-in">
          
          {/* Brand/Header */}
          <div className="text-center mb-8 relative">
            <div className="inline-flex items-center justify-center mb-5 group">
              {/* Soft glow for brand */}
              <div className="relative p-3.5 rounded-2xl bg-gradient-to-tr from-brand-500 to-brand-600 shadow-md shadow-brand-500/15 flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300">
                <UploadCloud className="h-7 w-7 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              FDCP Comms Uploader
            </h1>
            <p className="text-slate-500 text-sm mt-2 font-light tracking-wide">
              Securely authenticate to access the uploader system
            </p>
          </div>

          {/* Minimalist Switch Tab */}
          <div className="flex p-1 bg-slate-100/80 rounded-2xl border border-slate-200/30 mb-8">
            <button
              onClick={() => {
                setAuthMode('signin');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                authMode === 'signin'
                  ? 'bg-white text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setAuthMode('signup');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                authMode === 'signup'
                  ? 'bg-white text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-200/50'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Register
            </button>
          </div>

          {/* Alert Messages */}
          {authError && (
            <div className="flex items-center space-x-3 p-4 bg-red-50 border border-red-100 text-red-700 text-xs rounded-2xl mb-6 animate-shake">
              <AlertCircle className="h-4.5 w-4.5 text-red-500 flex-shrink-0" />
              <span className="font-semibold tracking-wide">{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="flex items-center space-x-3 p-4 bg-green-50 border border-green-100 text-green-700 text-xs rounded-2xl mb-6 animate-fade-in">
              <CheckCircle className="h-4.5 w-4.5 text-green-500 flex-shrink-0" />
              <span className="font-semibold tracking-wide">{authSuccess}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2.5 ml-1">
                Email Address
              </label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2.5 ml-1">
                Password
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer transition-colors duration-200 animate-fade-in"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="animate-fade-in">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2.5 ml-1">
                  Confirm Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-12 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200/80 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
                    required
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 mt-6 bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white font-bold tracking-wide rounded-2xl shadow-lg shadow-brand-500/15 hover:shadow-xl hover:shadow-brand-500/25 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              ) : (
                <span className="flex items-center space-x-2">
                  <span>{authMode === 'signin' ? 'Sign In' : 'Create Account'}</span>
                </span>
              )}
            </button>
          </form>

        </div>
      </div>
    );
  }

  // Authenticated Dashboard
  return (
    <div className="min-h-screen bg-slate-50 p-8 flex flex-col items-center">
      <div className="w-full max-w-3xl">
        
        {/* Top Header Panel */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm animate-fade-in">
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-brand-500 to-sky-400 flex items-center justify-center shadow-md shadow-brand-500/10">
              <UserIcon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider leading-none">Logged In As</p>
              <p className="text-sm font-bold text-slate-800 truncate mt-1">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center px-4 py-2 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-600 font-semibold text-sm rounded-xl transition-all duration-200 border border-slate-200/60 cursor-pointer"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </button>
        </div>

        {/* Dashboard Title */}
        <header className="mb-8 text-center sm:text-left animate-fade-in">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-2">FDCP Image Uploader</h1>
          <p className="text-slate-500 text-sm">Securely upload media to Amazon S3 and generate public URLs</p>
        </header>

        {/* Upload Zone */}
        <div 
          {...getRootProps()} 
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ease-in-out animate-fade-in ${
            isDragActive ? 'border-brand-500 bg-brand-50/50' : 'border-slate-300 bg-white hover:border-brand-400 hover:bg-slate-50'
          }`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center justify-center space-y-4">
            {isUploading ? (
              <Loader2 className="h-12 w-12 text-brand-500 animate-spin" />
            ) : (
              <UploadCloud className={`h-12 w-12 ${isDragActive ? 'text-brand-500' : 'text-slate-400'}`} />
            )}
            
            <div className="space-y-1">
              <p className="text-lg font-medium text-slate-700 animate-fade-in">
                {isUploading ? (statusMessage || 'Uploading...') : (isDragActive ? 'Drop files here...' : 'Drag & drop photos or videos here')}
              </p>
              <p className="text-sm text-slate-500">
                {isUploading ? 'Please wait, optimizing and uploading...' : 'or click to select files from your computer'}
              </p>
            </div>
          </div>
        </div>

        {/* Error / Alert Messages from Upload */}
        {authError && (
          <div className="flex items-center space-x-2 p-3.5 mt-4 bg-red-500/10 border border-red-500/20 text-red-200 text-sm rounded-xl animate-shake">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
            <span className="text-slate-800">{authError}</span>
          </div>
        )}

        {/* Uploads list */}
        {uploads.length > 0 && (
          <div className="mt-12 space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
              <h2 className="text-xl font-semibold text-slate-800 flex items-center">
                <CheckCircle className="w-5 h-5 mr-2 text-green-500" />
                Recent Uploads ({uploads.length})
              </h2>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => copyAllLinks('newline')}
                  className={`flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 shadow-sm border cursor-pointer ${
                    copiedAll === 'newline'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100 hover:border-brand-300'
                  }`}
                  title="Copy all links (one per line) to paste directly into a single column"
                >
                  {copiedAll === 'newline' ? (
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {copiedAll === 'newline' ? 'Copied Column!' : 'Copy as Column'}
                </button>
                <button
                  onClick={() => copyAllLinks('comma')}
                  className={`flex items-center px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 shadow-sm border cursor-pointer ${
                    copiedAll === 'comma'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                  title="Copy all links as comma-separated values"
                >
                  {copiedAll === 'comma' ? (
                    <CheckCircle className="w-3.5 h-3.5 mr-1.5 text-green-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {copiedAll === 'comma' ? 'Copied CSV!' : 'Copy as CSV'}
                </button>
              </div>
            </div>
            
            <div className="grid gap-4">
              {uploads.map((upload, index) => (
                <div key={index} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center space-x-4 transition-all hover:shadow-md animate-slide-in min-w-0">
                  <div className="h-16 w-16 flex-shrink-0 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">
                    {upload.url.match(/\.(jpeg|jpg|gif|png|webp)$/i) ? (
                      <img src={upload.url} alt={upload.filename} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-slate-400" />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{upload.originalName}</p>
                    <p className="text-xs text-slate-500 truncate mb-2">{upload.filename}</p>
                    
                    <div className="flex items-center space-x-2 w-full min-w-0">
                      <div className="flex-1 flex items-center px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200 min-w-0">
                        <LinkIcon className="w-3.5 h-3.5 text-slate-400 mr-2 flex-shrink-0" />
                        <span className="text-xs text-slate-600 truncate block">{upload.url}</span>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(upload.url)}
                        className={`flex-shrink-0 flex items-center px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                          copiedUrl === upload.url
                            ? 'bg-green-50 text-green-700'
                            : 'bg-brand-50 text-brand-600 hover:bg-brand-100'
                        }`}
                      >
                        {copiedUrl === upload.url ? (
                          <CheckCircle className="w-4 h-4 mr-1.5 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 mr-1.5" />
                        )}
                        {copiedUrl === upload.url ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
