// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBZl28505Ug9NVaOkCOCbC9MOCI9FrLK-Q",
  authDomain: "yabawifiadmin.firebaseapp.com",
  projectId: "yabawifiadmin",
  storageBucket: "yabawifiadmin.firebasestorage.app",
  messagingSenderId: "812889714710",
  appId: "1:812889714710:web:92b69accb84be5797c4537",
  measurementId: "G-1Y9XTFSFHJ",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, app };
