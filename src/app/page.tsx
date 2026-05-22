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
          body: formData,
        });
        
        const response = await res.json();
        
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
        }
      } catch (error: any) {
        console.error("Error invoking upload:", error);
        setAuthError(`Error uploading file: ${error.message || error}`);
        setTimeout(() => setAuthError(null), 5000);
      }
    }
    
    setIsUploading(false);
  }, [user]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    disabled: !user 
  });

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<'newline' | 'comma' | null>(null);

  const copyToClipboard = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const copyAllLinks = (format: 'newline' | 'comma') => {
    if (uploads.length === 0) return;
    const urls = uploads.map(u => u.url);
    const text = format === 'newline' ? urls.join('\n') : urls.join(', ');
    navigator.clipboard.writeText(text);
    setCopiedAll(format);
    setTimeout(() => setCopiedAll(null), 2000);
  };

  // Loading state when checking authentication
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center space-y-4">
        <div className="relative flex items-center justify-center">
          <div className="h-16 w-16 rounded-full border-4 border-brand-500/20 border-t-brand-500 animate-spin"></div>
          <ShieldCheck className="h-8 w-8 text-brand-400 absolute animate-pulse" />
        </div>
        <p className="text-slate-400 font-medium tracking-wide animate-pulse">Securing your workspace...</p>
      </div>
    );
  }

  // Not authenticated screen (Premium Login/Sign Up)
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background ambient glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-500/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-sky-500/10 blur-[120px] pointer-events-none" />

        <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl rounded-3xl p-8 relative z-10 transition-all duration-300">
          
          {/* Brand/Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-gradient-to-tr from-brand-500 to-sky-400 shadow-lg shadow-brand-500/20 mb-4 animate-bounce-slow">
              <UploadCloud className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">FDCP S3 Uploader</h1>
            <p className="text-slate-400 text-sm mt-1">Please sign in to access the image uploader</p>
          </div>

          {/* Form switch tab */}
          <div className="flex p-1 bg-slate-950/40 rounded-2xl border border-white/5 mb-6">
            <button
              onClick={() => {
                setAuthMode('signin');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all duration-300 ${
                authMode === 'signin'
                  ? 'bg-gradient-to-r from-brand-500 to-sky-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 cursor-pointer'
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
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-all duration-300 ${
                authMode === 'signup'
                  ? 'bg-gradient-to-r from-brand-500 to-sky-500 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 cursor-pointer'
              }`}
            >
              Register
            </button>
          </div>

          {/* Alert Messages */}
          {authError && (
            <div className="flex items-center space-x-2 p-3.5 bg-red-500/10 border border-red-500/20 text-red-200 text-sm rounded-xl mb-4 animate-shake">
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {authSuccess && (
            <div className="flex items-center space-x-2 p-3.5 bg-green-500/10 border border-green-500/20 text-green-200 text-sm rounded-xl mb-4 animate-fade-in">
              <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
              <span>{authSuccess}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-12 pr-4 py-3 bg-slate-950/30 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all duration-200"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-3 bg-slate-950/30 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all duration-200"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 focus:outline-none cursor-pointer"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="animate-fade-in">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-12 py-3 bg-slate-950/30 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all duration-200"
                    required
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 mt-4 bg-gradient-to-r from-brand-500 to-sky-500 hover:from-brand-600 hover:to-sky-600 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span>{authMode === 'signin' ? 'Sign In' : 'Create Account'}</span>
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
              <p className="text-lg font-medium text-slate-700">
                {isDragActive ? 'Drop files here...' : 'Drag & drop images here'}
              </p>
              <p className="text-sm text-slate-500">
                or click to select files from your computer
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
                <div key={index} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center space-x-4 transition-all hover:shadow-md animate-slide-in">
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
                    
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 flex items-center px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
                        <LinkIcon className="w-3.5 h-3.5 text-slate-400 mr-2 flex-shrink-0" />
                        <span className="text-xs text-slate-600 truncate">{upload.url}</span>
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
