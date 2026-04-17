import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocFromServer, getDocs, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
console.log("Initializing Firebase with project:", firebaseConfig.projectId);
const app = initializeApp(firebaseConfig);

// Use a safer initialization for Firestore
let dbInstance;
try {
  // Try to use the named database if provided, otherwise fallback to default
  if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)") {
    console.log("Using named Firestore database:", firebaseConfig.firestoreDatabaseId);
    dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  } else {
    console.log("Using default Firestore database");
    dbInstance = getFirestore(app);
  }
} catch (error) {
  console.error("Error initializing Firestore:", error);
  dbInstance = getFirestore(app);
}

export const db = dbInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signOut, onAuthStateChanged, collection, doc, setDoc, deleteDoc, onSnapshot, query, where, getDocFromServer, getDocs, getDoc, updateDoc, signInAnonymously, arrayUnion, arrayRemove };
export type { User };

// Test connection to Firestore with retries
async function testConnection(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Testing Firestore connection (attempt ${i + 1})...`);
      const testDoc = doc(db, 'test', 'connection');
      await getDocFromServer(testDoc);
      console.log("Firestore connection successful.");
      return;
    } catch (error) {
      if (error instanceof Error) {
        const isQuotaError = error.message.includes('Quota limit exceeded') || error.message.includes('Quota exceeded');
        
        if (isQuotaError) {
          console.error("Firestore Quota Exceeded. Stopping connection tests.");
          return; // Stop immediately if it's a quota error
        }

        console.warn(`Firestore connection attempt ${i + 1} failed:`, error.message);
        if (i === retries - 1) {
          if (error.message.includes('the client is offline') || error.message.includes('unavailable')) {
            console.error("Firestore is currently unavailable. This might be due to a configuration issue or the database not being fully provisioned yet.");
          } else {
            console.error("Firestore connection test failed after retries:", error.message);
          }
        } else {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const isQuotaError = errorMessage.includes('Quota limit exceeded') || errorMessage.includes('Quota exceeded');

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }

  // Log as error either way
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  // Only throw if it's NOT a quota error. 
  // Quota errors are handled via UI state to prevent noisy uncaught exceptions.
  if (!isQuotaError) {
    throw new Error(JSON.stringify(errInfo));
  }
}
