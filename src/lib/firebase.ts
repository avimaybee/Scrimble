import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBjaSbuwgaFSBDmhAEX5TcLuOPokBMNyp0",
  authDomain: "scrimble-auth.firebaseapp.com",
  projectId: "scrimble-auth",
  storageBucket: "scrimble-auth.firebasestorage.app",
  messagingSenderId: "714624747391",
  appId: "1:714624747391:web:214613547d5e8ace2ebc4a",
  measurementId: "G-EBBT2RYJQD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};
