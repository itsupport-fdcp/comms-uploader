"use client";

import { useState, useCallback, useEffect, useMemo } from 'react';
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
  EyeOff,
  Search,
  FileVideo,
  Trash2,
  Info,
  X,
  RefreshCw,
  Calendar,
  FileText
} from 'lucide-react';
import { auth, db } from '../firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy
} from 'firebase/firestore';

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

function formatBytes(bytes: number, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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

  // Tabs & Upload States
  const [dashboardTab, setDashboardTab] = useState<'upload' | 'history'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploads, setUploads] = useState<any[]>([]);

  // Advanced Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'photo' | 'video'>('all');
  const [filterUser, setFilterUser] = useState<'all' | 'me'>('all');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Modals / Interactivity
  const [selectedUpload, setSelectedUpload] = useState<any | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [reuploadingId, setReuploadingId] = useState<string | null>(null);

  // Monitor Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Monitor Firestore real-time history uploads
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'history'),
      orderBy('uploadedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUploads(historyList);
    }, (error) => {
      console.error("Firestore history listener error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthSuccess(null);

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
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setAuthError(null);
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  // Uploader Drop handler (with client-side conversion to WebP and serverless POST)
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user) return;
    setIsUploading(true);
    setAuthError(null);
    
    for (const file of acceptedFiles) {
      try {
        let processedFile = file;
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');

        if (isImage) {
          setStatusMessage("Optimizing image and converting to WebP...");
          processedFile = await compressImageToWebP(file);
        } else if (isVideo) {
          setStatusMessage("Uploading video for adaptive server compression...");
        } else {
          setStatusMessage(`Uploading ${file.name}...`);
        }

        const formData = new FormData();
        formData.append('file', processedFile);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (data.success) {
          setStatusMessage("Saving metadata to history database...");
          await addDoc(collection(db, 'history'), {
            originalName: file.name,
            filename: data.filename,
            url: data.url,
            size: file.size,
            compressedSize: data.compressedSize || file.size,
            type: isVideo ? 'video' : (isImage ? 'photo' : 'other'),
            uploadedBy: user.email,
            uploadedAt: new Date().toISOString(),
            status: 'uploaded'
          });
        } else {
          console.error("Upload failed:", data.error);
          setAuthError(`Upload failed: ${data.error}`);
          setTimeout(() => setAuthError(null), 5000);
        }
      } catch (error: any) {
        console.error("Error invoking upload:", error);
        setAuthError(`Error uploading file: ${error.message || error}`);
        setTimeout(() => setAuthError(null), 5000);
      }
    }
    
    setIsUploading(false);
    setStatusMessage(null);
  }, [user]);

  // Re-upload in place
  const handleReupload = async (id: string, file: File) => {
    if (!user) return;
    setReuploadingId(id);
    setAuthError(null);

    try {
      let processedFile = file;
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (isImage) {
        processedFile = await compressImageToWebP(file);
      }

      const formData = new FormData();
      formData.append('file', processedFile);

      // Upload replacement file
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        // Update the existing Firestore history record
        const docRef = doc(db, 'history', id);
        await updateDoc(docRef, {
          originalName: file.name,
          filename: data.filename,
          url: data.url,
          size: file.size,
          compressedSize: data.compressedSize || file.size,
          type: isVideo ? 'video' : (isImage ? 'photo' : 'other'),
          uploadedAt: new Date().toISOString()
        });
      } else {
        setAuthError(`Re-upload failed: ${data.error}`);
        setTimeout(() => setAuthError(null), 5000);
      }
    } catch (error: any) {
      console.error("Error in re-upload:", error);
      setAuthError(`Error re-uploading file: ${error.message || error}`);
      setTimeout(() => setAuthError(null), 5000);
    } finally {
      setReuploadingId(null);
    }
  };

  const triggerReupload = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        await handleReupload(id, file);
      }
    };
    input.click();
  };

  // Secure Delete
  const handleDelete = async (id: string) => {
    if (!user) return;
    setAuthError(null);
    
    const record = uploads.find(u => u.id === id);
    if (!record) return;

    try {
      setDeleteConfirmId(null);
      
      // 1. Delete from S3 first
      const s3Res = await fetch('/api/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: record.url }),
      });
      const s3Data = await s3Res.json();
      
      if (!s3Data.success) {
        console.warn("S3 delete response warning:", s3Data.error);
      }

      // 2. Delete from Firestore history tracking
      await deleteDoc(doc(db, 'history', id));
      
    } catch (error: any) {
      console.error("Error in delete execution:", error);
      setAuthError(`Error deleting file: ${error.message || error}`);
      setTimeout(() => setAuthError(null), 5000);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    disabled: !user 
  });

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<'newline' | 'comma' | null>(null);

  const fallbackCopy = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Copy fallback failed', err);
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

  // Filter calculations
  const filteredUploads = useMemo(() => {
    return uploads.filter(upload => {
      // Filename search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = 
          (upload.originalName && upload.originalName.toLowerCase().includes(query)) ||
          (upload.filename && upload.filename.toLowerCase().includes(query));
        if (!matchesName) return false;
      }

      // File Type filter
      if (filterType !== 'all') {
        if (filterType === 'photo' && upload.type !== 'photo') return false;
        if (filterType === 'video' && upload.type !== 'video') return false;
      }

      // User filter
      if (filterUser === 'me') {
        if (upload.uploadedBy !== user?.email) return false;
      }

      // Date Range filter
      if (filterStartDate) {
        const start = new Date(filterStartDate);
        start.setHours(0, 0, 0, 0);
        const uploadDate = new Date(upload.uploadedAt);
        if (uploadDate < start) return false;
      }
      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        const uploadDate = new Date(upload.uploadedAt);
        if (uploadDate > end) return false;
      }

      return true;
    });
  }, [uploads, searchQuery, filterType, filterUser, filterStartDate, filterEndDate, user]);

  // Loading state when checking authentication
  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4 animate-fade-in">
        <div className="relative flex items-center justify-center">
          <div className="h-16 w-16 rounded-full border-4 border-brand-500/10 border-t-brand-500 animate-spin"></div>
          <ShieldCheck className="h-8 w-8 text-brand-500 absolute animate-pulse" />
        </div>
        <p className="text-slate-500 text-sm font-semibold tracking-wide animate-pulse">Securing your workspace...</p>
      </div>
    );
  }

  // Not authenticated screen (Redesigned Minimalist Light Theme)
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Subtle Light Blurs */}
        <div className="absolute -top-[10%] -right-[10%] w-[500px] h-[500px] rounded-full bg-brand-100/30 blur-[120px] pointer-events-none animate-pulse-slow" />
        <div className="absolute -bottom-[10%] -left-[10%] w-[500px] h-[500px] rounded-full bg-indigo-50/40 blur-[120px] pointer-events-none animate-float-1" />

        {/* Minimalist Login Card */}
        <div className="w-full max-w-md bg-white border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.04)] rounded-[32px] p-8 md:p-10 relative z-10 transition-all duration-300 hover:shadow-[0_20px_60px_rgba(15,23,42,0.08)] animate-slide-in">
          
          {/* Brand/Header */}
          <div className="text-center mb-8 relative">
            <div className="inline-flex items-center justify-center mb-5 group">
              <div className="relative p-3.5 rounded-2xl bg-gradient-to-tr from-brand-500 to-brand-600 shadow-md shadow-brand-500/15 flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300">
                <UploadCloud className="h-7 w-7 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              FDCP S3 Comms Uploader
            </h1>
            <p className="text-slate-500 text-xs mt-2 font-medium tracking-wide">
              Securely authenticate to access the uploader system
            </p>
          </div>

          {/* Minimalist Switch Tab */}
          <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200/30 mb-8">
            <button
              onClick={() => {
                setAuthMode('signin');
                setAuthError(null);
                setAuthSuccess(null);
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                authMode === 'signin'
                  ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50'
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
                  ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50'
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
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-1">
                Email Address
              </label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-1">
                Password
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer transition-colors duration-200"
                >
                  {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                </button>
              </div>
            </div>

            {authMode === 'signup' && (
              <div className="animate-fade-in">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-1">
                  Confirm Password
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-brand-500 transition-colors duration-200" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-12 py-3.5 bg-slate-50/50 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-slate-800 placeholder-slate-400 focus:outline-none transition-all duration-200 text-sm"
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
                <span>{authMode === 'signin' ? 'Sign In' : 'Create Account'}</span>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Authenticated Dashboard with Left Sidebar Layout
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      
      {/* Sidebar Navigation Panel */}
      <aside className="w-full md:w-64 flex-shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200/50 flex flex-col z-20">
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-100 flex items-center space-x-3.5">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-brand-500 to-brand-600 shadow-md shadow-brand-500/10 flex items-center justify-center">
            <UploadCloud className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-800 tracking-tight leading-none">FDCP Comms</h2>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1.5 leading-none">S3 Uploader</p>
          </div>
        </div>

        {/* Navigation Options */}
        <nav className="flex-1 p-4 space-y-1.5">
          <button
            onClick={() => setDashboardTab('upload')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer ${
              dashboardTab === 'upload'
                ? 'bg-brand-50/70 text-brand-600 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.12)]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center space-x-3">
              <UploadCloud className="w-4 h-4" />
              <span>Upload Console</span>
            </span>
          </button>

          <button
            onClick={() => setDashboardTab('history')}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-xs font-bold transition-all duration-200 cursor-pointer ${
              dashboardTab === 'history'
                ? 'bg-brand-50/70 text-brand-600 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.12)]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center space-x-3">
              <FileText className="w-4 h-4" />
              <span>Upload History</span>
            </span>
            {uploads.length > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                dashboardTab === 'history' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {uploads.length}
              </span>
            )}
          </button>
        </nav>

        {/* Account Profile Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/40 space-y-3">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200/40 flex items-center justify-center text-[10px] font-extrabold text-slate-600 uppercase flex-shrink-0">
              {user.email?.substring(0, 2) || '??'}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">Uploader</p>
              <p className="text-xs font-bold text-slate-700 truncate mt-1.5 leading-none" title={user.email || undefined}>
                {user.email?.split('@')[0]}
              </p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center px-4 py-2.5 bg-white hover:bg-red-50 text-slate-600 hover:text-red-600 font-bold text-xs rounded-2xl transition-all duration-200 border border-slate-200/60 cursor-pointer shadow-xs"
          >
            <LogOut className="w-3.5 h-3.5 mr-2" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Dynamic Content Container */}
      <main className="flex-1 p-6 md:p-10 min-w-0 overflow-y-auto max-h-screen">
        <div className="max-w-4xl mx-auto space-y-6">
          
          {/* Header Title inside Content Area */}
          <header className="animate-fade-in flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {dashboardTab === 'upload' ? 'Upload Console' : 'Upload History'}
              </h1>
              <p className="text-xs text-slate-500 font-semibold mt-1">
                {dashboardTab === 'upload' 
                  ? 'Optimize and upload static photos or high-quality videos to AWS S3 securely' 
                  : 'Track, filter, and backtrack all team upload transactions from S3'}
              </p>
            </div>
          </header>

          {/* Tab 1: Upload Console */}
          {dashboardTab === 'upload' && (
            <div className="space-y-6 animate-fade-in">
              {/* Upload Zone */}
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-3xl p-16 text-center cursor-pointer transition-all duration-300 ease-in-out shadow-sm ${
                  isDragActive 
                    ? 'border-brand-500 bg-brand-50/20 scale-[1.005] shadow-md shadow-brand-500/5' 
                    : 'border-slate-200 bg-white hover:border-brand-400 hover:bg-slate-50/40 hover:shadow-md'
                }`}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center justify-center space-y-4">
                  {isUploading ? (
                    <div className="relative flex items-center justify-center">
                      <Loader2 className="h-14 w-14 text-brand-500 animate-spin" />
                      <UploadCloud className="h-6 w-6 text-brand-500 absolute animate-pulse" />
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-brand-50 transition-colors">
                      <UploadCloud className={`h-8 w-8 ${isDragActive ? 'text-brand-500' : 'text-slate-400'}`} />
                    </div>
                  )}
                  
                  <div className="space-y-2 max-w-md">
                    <p className="text-lg font-bold text-slate-800">
                      {isUploading ? (statusMessage || 'Processing upload...') : (isDragActive ? 'Drop your files here...' : 'Drag & drop photos or videos here')}
                    </p>
                    <p className="text-xs text-slate-400 font-medium leading-relaxed">
                      {isUploading 
                        ? 'Applying client-side conversion or spawning adaptive server encoders. Please wait...' 
                        : 'Photos will be converted to high-efficiency WebP under 1 MB. Videos will run server-side adaptive bitrates.'}
                    </p>
                    {!isUploading && (
                      <span className="inline-flex items-center text-xs font-bold text-brand-500 hover:text-brand-600 mt-2">
                        or click to browse files
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Error notifications */}
              {authError && (
                <div className="flex items-center space-x-3 p-4 bg-red-50 border border-red-100 text-red-700 text-xs rounded-2xl mb-6 animate-shake">
                  <AlertCircle className="h-4.5 w-4.5 text-red-500 flex-shrink-0" />
                  <span className="font-semibold tracking-wide">{authError}</span>
                </div>
              )}

              {/* Micro Quick List of last 3 uploads */}
              {uploads.length > 0 && (
                <div className="mt-8 animate-fade-in">
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Last Uploaded</h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => copyAllLinks('newline')}
                        className={`flex items-center px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 border cursor-pointer ${
                          copiedAll === 'newline'
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-xs'
                        }`}
                        title="Copy all uploaded S3 links (one per line) to clipboard"
                      >
                        <Copy className="w-3 h-3 mr-1.5" />
                        {copiedAll === 'newline' ? 'Copied Column!' : 'Copy as Column'}
                      </button>
                      <button
                        onClick={() => copyAllLinks('comma')}
                        className={`flex items-center px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all duration-200 border cursor-pointer ${
                          copiedAll === 'comma'
                            ? 'bg-green-50 border-green-200 text-green-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-xs'
                        }`}
                        title="Copy all uploaded S3 links as comma-separated values"
                      >
                        <Copy className="w-3 h-3 mr-1.5" />
                        {copiedAll === 'comma' ? 'Copied CSV!' : 'Copy as CSV'}
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    {uploads.slice(0, 3).map((upload) => (
                      <div key={upload.id} className="bg-white rounded-2xl p-4 border border-slate-100 flex items-center space-x-4 shadow-sm min-w-0">
                        <div className="h-12 w-12 flex-shrink-0 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200/40">
                          {upload.type === 'photo' ? (
                            <img src={upload.url} alt={upload.originalName} className="w-full h-full object-cover" />
                          ) : (
                            <FileVideo className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">{upload.originalName}</p>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{upload.url}</p>
                        </div>

                        <div className="flex items-center space-x-2 flex-shrink-0">
                          <button
                            onClick={() => copyToClipboard(upload.url)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-colors cursor-pointer ${
                              copiedUrl === upload.url
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            {copiedUrl === upload.url ? 'Copied!' : 'Copy Link'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Upload History Page */}
          {dashboardTab === 'history' && (
            <div className="space-y-4 animate-fade-in">
              
              {/* Filters panel */}
              <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex flex-col gap-4">
                <div className="flex flex-col md:flex-row gap-4">
                  {/* Search Bar */}
                  <div className="flex-1 relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files by name..."
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-2xl text-xs placeholder-slate-400 outline-none transition-all duration-200 text-slate-800"
                    />
                  </div>

                  {/* File Type filters */}
                  <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200/40">
                    <button
                      onClick={() => setFilterType('all')}
                      className={`px-4 py-1.5 text-xs font-bold rounded-xl cursor-pointer transition-all duration-150 ${
                        filterType === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      All Types
                    </button>
                    <button
                      onClick={() => setFilterType('photo')}
                      className={`px-4 py-1.5 text-xs font-bold rounded-xl cursor-pointer transition-all duration-150 ${
                        filterType === 'photo' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Photos
                    </button>
                    <button
                      onClick={() => setFilterType('video')}
                      className={`px-4 py-1.5 text-xs font-bold rounded-xl cursor-pointer transition-all duration-150 ${
                        filterType === 'video' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      Videos
                    </button>
                  </div>
                </div>

                {/* Grid selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Uploaded By</label>
                    <select
                      value={filterUser}
                      onChange={(e) => setFilterUser(e.target.value as any)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-xl text-xs outline-none text-slate-700 font-semibold transition-all duration-200 cursor-pointer"
                    >
                      <option value="all">All Users</option>
                      <option value="me">My Uploads</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">Start Date</label>
                    <input
                      type="date"
                      value={filterStartDate}
                      onChange={(e) => setFilterStartDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-xl text-xs outline-none text-slate-700 font-semibold transition-all duration-200 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ml-1">End Date</label>
                    <input
                      type="date"
                      value={filterEndDate}
                      onChange={(e) => setFilterEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-xl text-xs outline-none text-slate-700 font-semibold transition-all duration-200 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Reset filter indicator */}
                {(searchQuery || filterType !== 'all' || filterUser !== 'all' || filterStartDate || filterEndDate) && (
                  <div className="flex justify-end border-t border-slate-100 pt-3">
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setFilterType('all');
                        setFilterUser('all');
                        setFilterStartDate('');
                        setFilterEndDate('');
                      }}
                      className="text-[11px] font-bold text-brand-600 hover:text-brand-700 flex items-center space-x-1 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      <span>Reset Filters</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Bulk copy links */}
              {filteredUploads.length > 0 && (
                <div className="flex items-center justify-between gap-4 py-2 animate-fade-in">
                  <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                    Matches ({filteredUploads.length})
                  </span>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => copyAllLinks('newline')}
                      className={`flex items-center px-3 py-2 rounded-xl text-[10px] font-bold transition-all duration-200 border cursor-pointer ${
                        copiedAll === 'newline'
                          ? 'bg-green-50 border-green-200 text-green-700 shadow-sm shadow-green-500/5'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      {copiedAll === 'newline' ? 'Copied Column!' : 'Copy as Column'}
                    </button>
                    <button
                      onClick={() => copyAllLinks('comma')}
                      className={`flex items-center px-3 py-2 rounded-xl text-[10px] font-bold transition-all duration-200 border cursor-pointer ${
                        copiedAll === 'comma'
                          ? 'bg-green-50 border-green-200 text-green-700 shadow-sm shadow-green-500/5'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 shadow-sm'
                      }`}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      {copiedAll === 'comma' ? 'Copied CSV!' : 'Copy as CSV'}
                    </button>
                  </div>
                </div>
              )}

              {/* Main Data Table */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden animate-fade-in">
                <div className="overflow-x-auto min-w-0">
                  <table className="w-full border-collapse text-left min-w-[850px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">File Name</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Type</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Uploaded By</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Size</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</th>
                        <th className="px-6 py-4.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUploads.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-16 text-center">
                            <div className="flex flex-col items-center justify-center space-y-3.5">
                              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                                <Search className="w-6 h-6 text-slate-400 animate-pulse" />
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-bold text-slate-700">No uploads found</p>
                                <p className="text-xs text-slate-400 font-medium">We couldn't find any uploads that match your search filters.</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredUploads.map((upload) => {
                          const savings = upload.size && upload.compressedSize && upload.size > upload.compressedSize
                            ? Math.round(((upload.size - upload.compressedSize) / upload.size) * 100)
                            : 0;

                          return (
                            <tr key={upload.id} className="hover:bg-slate-50/40 transition-all duration-150 group">
                              <td className="px-6 py-4">
                                <div className="flex items-center space-x-3.5 min-w-0 max-w-[280px]">
                                  <div className="h-11 w-11 rounded-xl bg-slate-50 border border-slate-200/50 flex-shrink-0 overflow-hidden flex items-center justify-center relative">
                                    {upload.type === 'photo' ? (
                                      <img src={upload.url} alt={upload.originalName} className="w-full h-full object-cover" />
                                    ) : (
                                      <FileVideo className="w-5 h-5 text-slate-400" />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-800 truncate" title={upload.originalName}>
                                      {upload.originalName}
                                    </p>
                                    <p className="text-[10px] text-slate-400 truncate mt-0.5 font-medium" title={upload.filename}>
                                      {upload.filename}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase ${
                                  upload.type === 'video'
                                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-100/50'
                                    : 'bg-teal-50 text-teal-700 border border-teal-100/50'
                                }`}>
                                  {upload.type === 'video' ? 'Video' : 'Photo'}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center space-x-2.5">
                                  <div className="h-6 w-6 rounded-full bg-slate-100 border border-slate-200/50 flex items-center justify-center text-[9px] font-bold text-slate-500 uppercase">
                                    {upload.uploadedBy?.substring(0, 2) || '??'}
                                  </div>
                                  <span className="text-xs text-slate-600 truncate max-w-[120px] font-semibold" title={upload.uploadedBy}>
                                    {upload.uploadedBy?.split('@')[0]}
                                  </span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-xs text-slate-500 font-semibold">
                                {new Date(upload.uploadedAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </td>
                              <td className="px-6 py-4">
                                <div className="space-y-0.5">
                                  <div className="text-xs font-bold text-slate-800">
                                    {formatBytes(upload.compressedSize || upload.size)}
                                  </div>
                                  {savings > 0 && (
                                    <div className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-extrabold bg-green-50 text-green-700 border border-green-100/40 leading-none scale-[0.95] origin-left">
                                      {savings}% smaller
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center space-x-1.5">
                                  <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0 shadow-sm shadow-green-500/20"></span>
                                  <span className="text-xs text-slate-600 font-bold">Uploaded</span>
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end space-x-1.5">
                                  {/* Copy URL */}
                                  <button
                                    onClick={() => copyToClipboard(upload.url)}
                                    className={`p-2 rounded-xl border transition-all duration-150 cursor-pointer ${
                                      copiedUrl === upload.url
                                        ? 'bg-green-50 border-green-200 text-green-600'
                                        : 'bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 shadow-sm'
                                    }`}
                                    title="Copy URL"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </button>

                                  {/* View Details */}
                                  <button
                                    onClick={() => setSelectedUpload(upload)}
                                    className="p-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-700 transition-all duration-150 shadow-sm cursor-pointer"
                                    title="View Details"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>

                                  {/* In-place Reupload */}
                                  <button
                                    onClick={() => triggerReupload(upload.id)}
                                    disabled={reuploadingId === upload.id}
                                    className="p-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-slate-400 hover:text-slate-700 transition-all duration-150 disabled:opacity-50 shadow-sm cursor-pointer"
                                    title="Replace/Re-upload file"
                                  >
                                    {reuploadingId === upload.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-500" />
                                    ) : (
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    )}
                                  </button>

                                  {/* Delete */}
                                  <button
                                    onClick={() => setDeleteConfirmId(upload.id)}
                                    className="p-2 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-100 rounded-xl text-slate-400 hover:text-red-600 transition-all duration-150 shadow-sm cursor-pointer"
                                    title="Delete object"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

        </div>
      </main>

      {/* View Details Slide-over Modal */}
      {selectedUpload && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-lg bg-white border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.12)] rounded-[32px] p-6 md:p-8 animate-slide-in relative">
            <button
              onClick={() => setSelectedUpload(null)}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-extrabold text-slate-900 mb-6 flex items-center">
              <Info className="w-4.5 h-4.5 mr-2 text-brand-500" />
              File Properties & Optimization
            </h3>

            <div className="space-y-6">
              {/* Media Preview Box */}
              <div className="aspect-video bg-slate-50 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-200/50">
                {selectedUpload.type === 'photo' ? (
                  <img src={selectedUpload.url} alt={selectedUpload.originalName} className="w-full h-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <FileVideo className="w-10 h-10 text-slate-400 animate-bounce-slow" />
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Video Stream Container</span>
                  </div>
                )}
              </div>

              {/* Data Lists */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-5 text-[11px] border-t border-slate-100 pt-5">
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">Original Name</p>
                  <p className="text-slate-800 font-semibold mt-1 break-all leading-normal">{selectedUpload.originalName}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">S3 Filename Key</p>
                  <p className="text-slate-800 font-semibold mt-1 break-all leading-normal">{selectedUpload.filename}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">Original Size</p>
                  <p className="text-slate-800 font-bold mt-1">{formatBytes(selectedUpload.size)}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">Optimized Size</p>
                  <p className="text-slate-800 font-bold mt-1 flex items-center">
                    {formatBytes(selectedUpload.compressedSize || selectedUpload.size)}
                    {selectedUpload.size > selectedUpload.compressedSize && (
                      <span className="ml-2 px-1.5 py-0.5 text-[8px] bg-green-50 border border-green-100 text-green-700 rounded font-extrabold uppercase leading-none">
                        {Math.round(((selectedUpload.size - selectedUpload.compressedSize) / selectedUpload.size) * 100)}% saved
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">Uploaded By</p>
                  <p className="text-slate-800 font-semibold mt-1 truncate">{selectedUpload.uploadedBy}</p>
                </div>
                <div>
                  <p className="text-slate-400 font-bold uppercase tracking-wider">Upload Timestamp</p>
                  <p className="text-slate-800 font-semibold mt-1">
                    {new Date(selectedUpload.uploadedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* S3 Public Link container */}
              <div className="border-t border-slate-100 pt-5 flex items-center space-x-3">
                <div className="flex-1 flex items-center px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-2xl min-w-0">
                  <LinkIcon className="w-3.5 h-3.5 text-slate-400 mr-2 flex-shrink-0" />
                  <span className="text-[11px] text-slate-500 font-semibold truncate block leading-none">{selectedUpload.url}</span>
                </div>
                <button
                  onClick={() => copyToClipboard(selectedUpload.url)}
                  className={`px-4 py-2.5 text-xs font-bold rounded-2xl transition-all duration-200 border cursor-pointer flex-shrink-0 ${
                    copiedUrl === selectedUpload.url
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : 'bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-100'
                  }`}
                >
                  {copiedUrl === selectedUpload.url ? 'Copied URL!' : 'Copy Link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.12)] rounded-[32px] p-6 animate-slide-in relative">
            <div className="flex items-center space-x-2.5 mb-3">
              <div className="p-2 bg-red-50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900">
                Confirm Deletion
              </h3>
            </div>
            
            <p className="text-xs text-slate-400 font-semibold mb-6 leading-relaxed">
              Are you sure you want to permanently delete this object? It will be removed immediately from S3 storage and deleted from the history tracking. This action is irreversible.
            </p>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-3 border border-slate-200 hover:bg-slate-50 text-slate-500 font-bold text-xs rounded-2xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-2xl transition-all shadow-md shadow-red-600/10 hover:shadow-red-600/20 active:scale-[0.98] cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
