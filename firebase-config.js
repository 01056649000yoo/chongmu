// Firebase Configuration
// 실제 Firebase 프로젝트 설정값

const firebaseConfig = {
    apiKey: "AIzaSyAyxWyAxaAAtV5qf2XdwHiOPzUVxkDWUfk",
    authDomain: "chongmu.firebaseapp.com",
    projectId: "chongmu",
    storageBucket: "chongmu.firebasestorage.app",
    messagingSenderId: "729138930984",
    appId: "1:729138930984:web:5e569c46f159013f0f5c1d",
    measurementId: "G-G3EZ95DE9E"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Firebase services
const auth = firebase.auth();
const db = firebase.firestore();

// Auth state observer
let currentUser = null;
let currentSessionId = null;
let unsubscribeSnapshot = null;

auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateAuthUI();
    if (user) {
        console.log('Logged in as:', user.email);
    } else {
        console.log('Logged out');
        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
    }
});

// Update UI based on auth state
function updateAuthUI() {
    const authSection = document.getElementById('authSection');
    const sessionSection = document.getElementById('sessionSection');
    const userInfo = document.getElementById('userInfo');
    const loginForm = document.getElementById('loginForm');

    if (currentUser) {
        loginForm.style.display = 'none';
        userInfo.style.display = 'block';
        userInfo.querySelector('#userEmail').textContent = currentUser.email;
        sessionSection.style.display = 'block';
    } else {
        loginForm.style.display = 'block';
        userInfo.style.display = 'none';
        sessionSection.style.display = 'none';
    }
}

// Auth functions
async function signUp(email, password) {
    try {
        await auth.createUserWithEmailAndPassword(email, password);
        alert('회원가입 성공! 로그인되었습니다.');
    } catch (error) {
        alert('회원가입 실패: ' + error.message);
    }
}

async function signIn(email, password) {
    try {
        await auth.signInWithEmailAndPassword(email, password);
        alert('로그인 성공!');
    } catch (error) {
        alert('로그인 실패: ' + error.message);
    }
}

async function signOut() {
    try {
        await auth.signOut();
        currentSessionId = null;
        state.participants = [];
        state.expenses = [];
        renderAll();
        alert('로그아웃되었습니다.');
    } catch (error) {
        alert('로그아웃 실패: ' + error.message);
    }
}

// Firestore functions
async function joinSession(sessionId) {
    if (!currentUser) {
        alert('먼저 로그인하세요.');
        return;
    }
    if (!sessionId.trim()) {
        alert('세션 코드를 입력하세요.');
        return;
    }

    currentSessionId = sessionId.trim();

    // Unsubscribe from previous session
    if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
    }

    // Subscribe to real-time updates
    const docRef = db.collection('sessions').doc(currentSessionId);

    unsubscribeSnapshot = docRef.onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            state.participants = data.participants || [];
            state.expenses = data.expenses || [];
            renderAll();
            console.log('Session data updated');
        } else {
            // Create new session if doesn't exist
            docRef.set({
                participants: [],
                expenses: [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            state.participants = [];
            state.expenses = [];
            renderAll();
            console.log('New session created');
        }
    }, (error) => {
        console.error('Snapshot error:', error);
        alert('데이터 동기화 오류: ' + error.message);
    });

    document.getElementById('currentSession').textContent = currentSessionId;
    document.getElementById('sessionStatus').style.display = 'block';
    alert(`세션 "${currentSessionId}"에 참가했습니다.`);
}

async function saveToFirestore() {
    if (!currentUser || !currentSessionId) {
        console.log('Not logged in or no session');
        return;
    }

    try {
        await db.collection('sessions').doc(currentSessionId).set({
            participants: state.participants,
            expenses: state.expenses,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        console.log('Saved to Firestore');
    } catch (error) {
        console.error('Save error:', error);
    }
}

// saveState 뒤에 Firestore 저장을 덧붙인다 (app.js 의 saveState 는 선언식이라 덮어쓰기로만 가능)
{
    const baseSaveState = saveState;
    saveState = function () {
        baseSaveState();
        saveToFirestore();
    };
}
