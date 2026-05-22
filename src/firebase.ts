import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyD5jsN2B3ngQTYhFWfXE0JbwnPJz22dF98",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "s3-uploader-2a975.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "s3-uploader-2a975",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "s3-uploader-2a975.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "79916254774",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:79916254774:web:2761d353f91996381afa97",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-5YRXJRMHVX",
};

// Initialize Firebase app.
const app = initializeApp(firebaseConfig);

// Export Auth instance for use throughout the UI.
export const auth = getAuth(app);

// Conditionally initialize analytics since it is environment-dependent (e.g. unsupported in SSR)
export const analyticsPromise = isSupported()
  .then((supported) => (supported ? getAnalytics(app) : null))
  .catch(() => null);
