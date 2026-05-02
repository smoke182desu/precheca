import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isSigningIn: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType>({} as FirebaseContextType);

export const useFirebase = () => useContext(FirebaseContext);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
         // Create or find user doc
         const userRef = doc(db, `users/${currentUser.uid}`);
         const userSnap = await getDoc(userRef);
         if (!userSnap.exists()) {
             await setDoc(userRef, {
                 email: currentUser.email || `${currentUser.uid}@fallback.net`,
                 displayName: currentUser.displayName || '',
                 activeProfileId: 'profile-intermediario', // Default seed values
                 activeCategoryId: 'X',
                 createdAt: serverTimestamp(),
                 updatedAt: serverTimestamp()
             });
         }
      }
      setUser(currentUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/cancelled-popup-request') {
        console.log('Sign in popup closed by user');
      } else if (error.code === 'auth/popup-closed-by-user') {
        console.log('Sign in popup closed by user');
      } else {
        console.error('Sign in error:', error);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logOut = async () => {
    await signOut(auth);
  };

  return (
    <FirebaseContext.Provider value={{ user, loading, isSigningIn, signIn, logOut }}>
      {children}
    </FirebaseContext.Provider>
  );
};
