import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut } from 'firebase/auth';
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

const createUserDoc = async (currentUser: User) => {
  const userRef = doc(db, `users/${currentUser.uid}`);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: currentUser.email || `${currentUser.uid}@fallback.net`,
      displayName: currentUser.displayName || '',
      activeProfileId: 'profile-intermediario',
      activeCategoryId: 'X',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
};

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    // Handle redirect result when app loads after Google login
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await createUserDoc(result.user);
        }
      })
      .catch((error) => {
        console.error('Redirect result error:', error);
      });

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        await createUserDoc(currentUser);
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
      await signInWithRedirect(auth, provider);
      // Page will redirect — isSigningIn stays true until redirect completes
    } catch (error: any) {
      console.error('Sign in error:', error);
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
