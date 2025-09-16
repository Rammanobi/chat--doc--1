// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration.
// This is sensitive and should not be committed to version control.
const firebaseConfig = {
  apiKey: "AIzaSyBCLwQYQEWgSRsMFmlnaFyprM3V3apcAyk",
  authDomain: "chat--doc--1.firebaseapp.com",
  projectId: "chat--doc--1",
  storageBucket: "chat--doc--1.firebasestorage.app ",
  messagingSenderId: "981927004855",
  appId: "1:981927004855:web:8bf37c6dd0e6d01878db32",
  measurementId: "G-JMLG5MP7Z3"
};
/*
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);

// Use your default bucket (firebasestorage.app for your project)
export const storage = getStorage(app); // or: getStorage(app, "gs://chat--doc--1.firebasestorage.app")

// IMPORTANT: your callable is deployed in us-central1
export const functions = getFunctions(app, "us-central1");

export default app;
*/
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);
// Explicitly bind storage to the correct bucket to prevent default-bucket mismatches
export const storage = getStorage(app, "gs://chat--doc--1.firebasestorage.app");
export const functions = getFunctions(app);

export default app;