function parseJsonSafely(rawValue) {
    if (!rawValue) return null;
    try {
        return JSON.parse(rawValue);
    } catch (error) {
        console.warn('Unable to parse JSON value', error);
        return null;
    }
}

function resolveFirebaseConfig() {
    if (typeof window !== 'undefined') {
        if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
            return window.FIREBASE_CONFIG;
        }
        if (window.__FIREBASE_CONFIG__ && window.__FIREBASE_CONFIG__.apiKey) {
            return window.__FIREBASE_CONFIG__;
        }
    }

    const embeddedScript = document.getElementById('firebase-config');
    if (embeddedScript && embeddedScript.textContent?.trim()) {
        const parsed = parseJsonSafely(embeddedScript.textContent.trim());
        if (parsed && parsed.apiKey) {
            return parsed;
        }
    }

    const metaTag = document.querySelector('meta[name="firebase-config"]');
    if (metaTag) {
        const parsed = parseJsonSafely(metaTag.getAttribute('content'));
        if (parsed && parsed.apiKey) {
            return parsed;
        }
    }

    return null;
}

function getElement(id) {
    return document.getElementById(id);
}

function updateText(id, value) {
    const el = getElement(id);
    if (el) {
        el.textContent = value;
    }
}

// Firebase Configuration - ปรับค่าได้จาก window.FIREBASE_CONFIG หรือแท็กฝังในเอกสาร
const firebaseConfig = resolveFirebaseConfig();

// Initialize Firebase
let db = null;
let auth = null;
let analytics = null;

if (firebaseConfig && firebaseConfig.apiKey) {
    try {
        // Initialize Firebase App
        firebase.initializeApp(firebaseConfig);

        // Initialize services
        db = firebase.firestore();
        auth = firebase.auth();

        // Initialize Analytics (optional)
        if (typeof firebase.analytics === 'function') {
            analytics = firebase.analytics();
            console.log('Firebase Analytics initialized');
        }

        // Configure Firestore settings
        db.settings({
            cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED
        });

        // Enable offline persistence
        db.enablePersistence({ synchronizeTabs: true })
            .then(() => {
                console.log('Firestore offline persistence enabled');
            })
            .catch((err) => {
                console.log('Firestore offline persistence failed:', err);
            });

        console.log('🔥 Firebase initialized successfully with real database!');
        showNotification('เชื่อมต่อฐานข้อมูลสำเร็จ! 🔥', 'success');

    } catch (error) {
        console.error('Firebase initialization error:', error);
        showNotification('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล กำลังใช้ระบบสำรอง', 'error');
    }
} else {
    console.warn('Firebase configuration not provided. Running in offline mode.');
}

// Game State Management
const gameState = {
    currentStep: 1,
    maxStepReached: 1,
    translatedWords: {},
    incorrectWords: {},
    wordAttempts: {}, // Track number of incorrect attempts per word
    imaginationText: '',
    interpretationText: '',
    comprehensionScore: 0,
    startTime: Date.now(),
    selectedWord: null,
    userId: null,
    gameId: null,
    stepHistory: []
};

const playerProfile = {
    exp: 0,
    rank: 'มือใหม่',
    totalGamesPlayed: 0,
    bestScore: 0,
    level: 1,
    expToNextLevel: 100
};

const DEFAULT_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="%233b82f6"/><circle cx="20" cy="15" r="8" fill="%23ffffff"/><path d="M20 24c-6 0-12 3.2-12 9h24c0-5.8-6-9-12-9z" fill="%23ffffff"/></svg>';
let floatingActionsDocHandler = null;
let floatingActionsInitialized = false;
let stepChipEventsInitialized = false;
let isEditingStudentProfile = false;
let editingStudentId = null;
let activeModalCount = 0;

function incrementModalCount() {
    activeModalCount += 1;
    if (typeof document !== 'undefined') {
        document.body.classList.add('modal-open');
        document.body.classList.add('overflow-hidden');
    }
}

function decrementModalCount() {
    activeModalCount = Math.max(0, activeModalCount - 1);
    if (activeModalCount === 0 && typeof document !== 'undefined') {
        document.body.classList.remove('modal-open');
        document.body.classList.remove('overflow-hidden');
    }
}

const DEFAULT_TEACHER_ACCOUNTS = {
    "teacher@thailit.app": {
        passcodeSegments: ['lit', 'pass', '123'],
        name: "ครูอารีย์ วิชิต",
        department: "กลุ่มสาระภาษาไทย",
        classes: ["ม.4/1", "ม.4/2"],
        role: "หัวหน้ากลุ่มสาระ",
        demo: true
    },
    "headteacher@thailit.app": {
        passcodeSegments: ['th', 'ail', 'it', '789'],
        name: "ครูวราภรณ์ มั่นคง",
        department: "กลุ่มสาระภาษาไทย",
        classes: ["ม.5/1", "ม.5/3", "ชมรมวรรณศิลป์"],
        role: "ครูพี่เลี้ยง",
        demo: true
    }
};

const teacherCredentials = (() => {
    if (typeof window !== 'undefined' && window.TEACHER_ACCOUNTS) {
        return window.TEACHER_ACCOUNTS;
    }
    return DEFAULT_TEACHER_ACCOUNTS;
})();

let currentTeacher = null;
const teacherDashboardState = {
    rows: [],
    sessions: [],
    students: []
};

const RANK_TIERS = [
    { id: 'legend', label: 'นักสืบเซียน', icon: '🥇', minScore: 1000, description: '1000+ แต้ม' },
    { id: 'pro', label: 'นักสืบชำนาญ', icon: '🥈', minScore: 500, description: '500+ แต้ม' },
    { id: 'adept', label: 'นักสืบฝึกหัด', icon: '🥉', minScore: 200, description: '200+ แต้ม' },
    { id: 'rookie', label: 'มือใหม่', icon: '🌟', minScore: 0, description: '0+ แต้ม' }
];

const SORTED_RANK_TIERS = [...RANK_TIERS].sort((a, b) => b.minScore - a.minScore);

function determineRankTier(score = 0) {
    return SORTED_RANK_TIERS.find(tier => score >= tier.minScore) || SORTED_RANK_TIERS[SORTED_RANK_TIERS.length - 1];
}

const STEP_LABELS = {
    1: '📚 ประวัติศาสตร์',
    2: '📖 อ่านโคลงสอบศัพท์',
    3: '📝 ถอดความ',
    4: '🖼️ เปิดภาพจริง',
    5: '📝 ทบทวน',
    6: '🏆 สรุปผล'
};

function getStepLabel(step) {
    if (step === undefined || step === null) {
        return 'ยังไม่เริ่ม';
    }
    if (step === 2.5) {
        return STEP_LABELS[2];
    }
    return STEP_LABELS[step] || `ขั้นที่ ${step}`;
}

function reconstructPasscode(credential) {
    if (!credential) return '';
    if (Array.isArray(credential.passcodeSegments)) {
        return credential.passcodeSegments.join('');
    }
    if (typeof credential.passcode === 'string') {
        return credential.passcode;
    }
    return '';
}

async function hashPasscode(passcode) {
    if (!passcode) return '';
    try {
        if (window.crypto?.subtle?.digest) {
            const encoder = new TextEncoder();
            const data = encoder.encode(passcode);
            const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch (error) {
        console.warn('Secure hashing unavailable, falling back to lightweight hash.', error);
    }

    let hash = 0;
    for (let i = 0; i < passcode.length; i++) {
        hash = ((hash << 5) - hash) + passcode.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString(16);
}

function shouldShowPassHint(credential) {
    return Boolean(credential && (credential.demo === true || credential.showHint === true));
}

function populateDemoTeacherHints() {
    const hintElements = document.querySelectorAll('[data-demo-pass]');
    hintElements.forEach(element => {
        const email = element.dataset.demoPass;
        const credential = teacherCredentials[email];
        if (!credential || !shouldShowPassHint(credential)) {
            element.textContent = 'กรุณาใช้รหัสผ่านที่ได้รับจากคุณครู';
            return;
        }

        const passcode = reconstructPasscode(credential);
        element.textContent = passcode || 'ใช้รหัสผ่านที่ได้รับจากคุณครู';
    });
}

function refreshTeacherViewIfNeeded() {
    if (currentTeacher) {
        renderTeacherDashboard().catch(error => console.error('Teacher dashboard refresh failed:', error));
    }
}

// Mission Data
const MISSION_DATA = {
    MISSION_01: {
        title: "โคลงสี่สุภาพ - พระราชพงศาวดาร",
        historicalBackground: {
            title: "ประวัติศาสตร์: สมเด็จพระสุริโยทัย",
            content: `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <article class="bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-200 rounded-2xl p-6 h-full">
                        <h4 class="text-xl font-bold text-amber-900 mb-4">👑 สมเด็จพระสุริโยทัย</h4>
                        <p class="text-amber-800 leading-relaxed">
                            สมเด็จพระสุริโยทัย เป็นพระมเหสีของสมเด็จพระมหาจักรพรรดิแห่งกรุงศรีอยุธยา (พระเจ้าช้างเผือก หรือพระนามเดิม พระเทียรราชา)
                            ทรงเป็นบุคคลสำคัญในประวัติศาสตร์ไทย ที่ทรงแสดงความกล้าหาญในการปกป้องแผ่นดิน
                        </p>
                    </article>

                    <article class="bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-2xl p-6 h-full">
                        <h4 class="text-xl font-bold text-red-900 mb-4">⚔️ สงครามคราวเสียสมเด็จพระสุริโยทัย</h4>
                        <p class="text-red-800 leading-relaxed">
                            เมื่อพระเจ้าแปร (พระเจ้าตะโดธรรมราชาที่ 1) แห่งพม่ายกทัพมาตีกรุงศรีอยุธยา
                            สมเด็จพระสุริโยทัยทรงแต่งกายเป็นทหาร ขี่ช้างออกรบเพื่อช่วยเหลือพระราชสามี
                        </p>
                    </article>

                    <article class="bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-2xl p-6 h-full">
                        <h4 class="text-xl font-bold text-purple-900 mb-4">🐘 การสิ้นพระชนม์อย่างกล้าหาญ</h4>
                        <p class="text-purple-800 leading-relaxed">
                            ในระหว่างการรบ สมเด็จพระสุริโยทัยทรงขี่ช้างเข้าไปช่วยเหลือพระราชสามีที่ตกอยู่ในอันตราย
                            แต่ทรงถูกพระเจ้าแปรใช้ง้าวฟันจนสิ้นพระชนม์บนหลังช้าง เป็นการเสียสละเพื่อแผ่นดิน
                        </p>
                    </article>

                    <article class="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-6 h-full">
                        <h4 class="text-xl font-bold text-green-900 mb-4">📜 บันทึกในพระราชพงศาวดาร</h4>
                        <p class="text-green-800 leading-relaxed">
                            เหตุการณ์นี้ได้รับการบันทึกไว้ในพระราชพงศาวดารกรุงศรีอยุธยา
                            และได้รับการประพันธ์เป็นโคลงสี่สุภาพ เพื่อสรรเสริญพระเกียรติคุณและความกล้าหาญ
                        </p>
                    </article>
                </div>
            `
        },
        poem: `<div class="kloang-container">
            <!-- บาทที่ ๑: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ -->
            <div class="bart">
                <span class="wak-na">๏ <span class="word-to-find" data-word="นงคราญ">นงคราญ</span>องค์เอกแก้ว</span>
                <span class="wak-lang">กระษัตรีย์</span>
            </div>

            <!-- บาทที่ ๒: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ -->
            <div class="bart">
                <span class="wak-na"><span class="word-to-find" data-word="มาน">มาน</span>มนัส<span class="word-to-find" data-word="กัตเวที">กัตเวที</span></span>
                <span class="wak-lang">ยิ่งล้ำ</span>
            </div>

            <!-- บาทที่ ๓: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ + คำสร้อย 2 คำ -->
            <div class="bart">
                <span class="wak-na">เกรงพระราชสามี</span>
                <span class="wak-lang"><span class="word-to-find" data-word="มลาย">มลาย</span>พระ</span>
                <span class="kam-sroi">ชนม์เฮย</span>
            </div>

            <!-- บาทที่ ๔: วรรคหน้า 5 คำ + วรรคหลัง 4 คำ -->
            <div class="bart">
                <span class="wak-na">ขับ<span class="word-to-find" data-word="คเชนทร">คเชนทร</span>เข่นค้ำ</span>
                <span class="wak-lang">สะอึกสู้<span class="word-to-find" data-word="ดัสกร">ดัสกร</span></span>
            </div>

            <!-- บาทที่ ๕: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ -->
            <div class="bart">
                <span class="wak-na"> ๏ ขุนมอญร่อน<span class="word-to-find" data-word="ง้าว">ง้าว</span>ฟาด</span>
                <span class="wak-lang">ฉาดฉะ</span>
            </div>

            <!-- บาทที่ ๖: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ -->
            <div class="bart">
                <span class="wak-na">ขาด<span class="word-to-find" data-word="แล่ง">แล่ง</span>ตราบ<span class="word-to-find" data-word="อุระ">อุระ</span></span>
                <span class="wak-lang"><span class="word-to-find" data-word="หรุบ">หรุบ</span>ดิ้น</span>
            </div>

            <!-- บาทที่ ๗: วรรคหน้า 5 คำ + วรรคหลัง 2 คำ + คำสร้อย 2 คำ -->
            <div class="bart">
                <span class="wak-na">โอรสรีบกันพระ</span>
                <span class="wak-lang">ศพสู่</span>
                <span class="kam-sroi">นครแฮ</span>
            </div>

            <!-- บาทที่ ๘: วรรคหน้า 5 คำ + วรรคหลัง 4 คำ -->
            <div class="bart">
                <span class="wak-na">สูญชีพ<span class="word-to-find" data-word="ไป่">ไป่</span>สูญสิ้น</span>
                <span class="wak-lang"><span class="word-to-find" data-word="พจน์">พจน์</span>ผู้สรรเสริญ</span>
            </div>
        </div>`,
        hardWords: {
            "นงคราญ": { meaning: "นางงาม, สาวงาม, หญิงสาวที่มีความงาม, พระนาง", points: 15 },
            "มาน": { meaning: "หัวใจ, จิตใจ, ความรู้สึก, อารมณ์", points: 15 },
            "กัตเวที": { meaning: "ตอบแทนคุณ, รู้คุณ, กตัญญู, สำนึกในพระคุณ", points: 20 },
            "มลาย": { meaning: "ตาย, สิ้นชีวิต, เสียชีวิต, สวรรคต", points: 18 },
            "คเชนทร": { meaning: "ช้าง, ช้างเผือก, พาหนะ, สัตว์ใหญ่", points: 20 },
            "ดัสกร": { meaning: "ข้าศึก, ศัตรู, คู่อริ, ผู้ร้าย", points: 18 },
            "ง้าว": { meaning: "ดาบด้ามยาว, ทวน, อาวุธ, หอก, ใส", points: 15 },
            "แล่ง": { meaning: "ผ่า, แยก, ฟัน, ตัด", points: 15 },
            "อุระ": { meaning: "อก, หน้าอก, ทรวงอก, ส่วนหน้าของร่างกาย", points: 12 },
            "หรุบ": { meaning: "ร่วง, ตก, ล้ม, หล่น", points: 15 },
            "ไป่": { meaning: "ไม่, มิ, หา...ไม่, ปฏิเสธ", points: 10 },
            "พจน์": { meaning: "พูด, กล่าว, คำพูด, วาจา", points: 15 }
        },
        correctInterpretation: "สมเด็จพระสุริโยทัยเกรงว่าพระสวามีจะสิ้นพระชนม์จึงได้ขับช้างเข้าขวางพระเจ้าแปรและต่อสู้กับพระเจ้าแปรแทน พระเจ้าแปรเอาง้าวฟันพระสุริโยทัย ผ่าตรงอกสิ้นพระชนม์บนคอช้าง สองพระโอรสคือ พระราเมศวร และมหินทราได้กันพระศพแล้วนำเข้าสู่เมือง สมเด็จพระสุริโยทัยสิ้นพระชนม์ไปแล้ว จึงเหลือแต่คำสรรเสริญเยินยอ",
        correctInterpretationKeywords: [
            "สมเด็จพระสุริโยทัย", "กระษัตรีย์", "ตอบแทนคุณ", "พระราชสามี", "ตาย", 
            "ช้าง", "ข้าศึก", "ขุนมอญ", "ง้าว", "ผ่า", "อก", "ร่วง", "โอรส", "พระศพ", "นคร", "คำพูด", "สรรเสริญ"
        ],
        officialImageURL: "https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_y6eb9wy6eb9wy6eb.png",
        officialImageDescription: "ภาพการต่อสู้ของสมเด็จพระสุริโยทัยบนหลังช้าง แสดงให้เห็นถึงความกล้าหาญในการปกป้องแผ่นดินและพระราชสามี",
        comprehensionQuestions: [
            {
                question: "จากการถอดความ สมเด็จพระสุริโยทัยทรงมีความรู้สึกอย่างไรต่อพระราชสามี",
                options: ["เกรงกลัว", "เกรงใจและห่วงใย", "โกรธแค้น", "เฉยเมย"],
                correct: 1
            },
            {
                question: "เหตุใดสมเด็จพระสุริโยทัยจึงตัดสินใจขับช้างเข้าสู่การรบ",
                options: ["เพื่อแสดงความกล้าหาญ", "เพื่อช่วยเหลือพระราชสามี", "เพื่อต่อสู้กับศัตรู", "เพื่อปกป้องแผ่นดิน"],
                correct: 1
            },
            {
                question: "คำว่า 'ขาดแล่งตราบอุระ หรุบดิ้น' สื่อความหมายว่าอย่างไร",
                options: ["ถูกฟันที่แขน", "ถูกผ่าที่อกและล้มลง", "ถูกแทงที่ท้อง", "ถูกตีที่หลัง"],
                correct: 1
            },
            {
                question: "ความรู้สึกหลักที่โคลงนี้ต้องการสื่อคืออะไร",
                options: ["ความเศร้าโศก", "ความกล้าหาญและการเสียสละ", "ความโกรธแค้น", "ความหวาดกลัว"],
                correct: 1
            },
            {
                question: "จากโคลง 'สูญชีพไป่สูญสิ้น พจน์ผู้สรรเสริญ' มีความหมายว่าอย่างไร",
                options: ["ชีวิตจบลงแต่ชื่อเสียงยังคงอยู่", "ทุกอย่างหายไปหมด", "ไม่มีใครจำได้", "เหลือแต่ความทรงจำ"],
                correct: 0
            }
        ]
    }
};

// Database Functions
async function saveUserData(userData) {
    try {
        if (db && gameState.userId) {
            // Save to Firebase User collection
            await db.collection('User').doc(gameState.userId).set(userData, { merge: true });
            console.log('User data saved to Firebase User collection');
        } else {
            // Fallback to localStorage
            localStorage.setItem(`student_${gameState.userId}`, JSON.stringify(userData));
            console.log('User data saved to localStorage');
        }
        refreshTeacherViewIfNeeded();
        return true;
    } catch (error) {
        console.error('Error saving user data:', error);
        // Fallback to localStorage
        localStorage.setItem(`student_${gameState.userId}`, JSON.stringify(userData));
        refreshTeacherViewIfNeeded();
        return false;
    }
}

async function loadUserData(userId) {
    try {
        if (db) {
            // Try Firebase User collection first
            const doc = await db.collection('User').doc(userId).get();
            if (doc.exists) {
                console.log('User data loaded from Firebase User collection');
                return doc.data();
            }
        }

        // Fallback to localStorage
        const localData = localStorage.getItem(`student_${userId}`);
        if (localData) {
            console.log('User data loaded from localStorage');
            return JSON.parse(localData);
        }

        return null;
    } catch (error) {
        console.error('Error loading user data:', error);
        // Fallback to localStorage
        const localData = localStorage.getItem(`student_${userId}`);
        return localData ? JSON.parse(localData) : null;
    }
}

async function saveGameSession(gameDataOverride) {
    try {
        const sessionTimestamp = new Date().toISOString();

        const fallbackGameData = (typeof window !== 'undefined' && typeof window.gameData === 'object' && window.gameData)
            ? window.gameData
            : {};
        const safeGameData = (typeof gameDataOverride === 'object' && gameDataOverride)
            ? gameDataOverride
            : fallbackGameData;
        const safeUser = (typeof gameState === 'object' && gameState?.currentUser)
            ? gameState.currentUser
            : {};

        const sessionData = {
            ...safeGameData,
            userId: gameState?.userId || safeUser.uid || '',
            userName: safeUser.name || safeUser.displayName || 'Unknown',
            userEmail: safeUser.email || '',
            studentId: safeUser.studentId || '',
            currentStep: Number(gameState?.currentStep ?? 0),
            completed: gameState?.currentStep === 6 || !!gameState?.completed,
            comprehensionScore: Number(gameState?.comprehensionScore ?? 0),
            matchingScore: Number(gameState?.matchingScore ?? 0),
            matchedPairs: Number(gameState?.matchedPairs ?? 0),
            lastUpdated: sessionTimestamp,
            timestamp: sessionTimestamp,
        };

        const generatedId = `${sessionData.userId || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const sessionId = gameState?.gameId || generatedId;
        if (!gameState?.gameId) {
            gameState.gameId = sessionId;
        }

        let savedRemotely = false;

        if (typeof db !== 'undefined' && db) {
            try {
                await db.collection('GameSession').doc(sessionId).set(sessionData);
                savedRemotely = true;
            } catch (primaryError) {
                console.warn('Primary GameSession collection write failed, trying legacy collection', primaryError);
                try {
                    await db.collection('gameSessions').doc(sessionId).set(sessionData);
                    savedRemotely = true;
                } catch (legacyError) {
                    console.error('Legacy gameSessions collection write failed', legacyError);
                }
            }

            if (savedRemotely) {
                console.log('GameSession saved to Firestore:', sessionId);
            }
        }

        if (typeof localStorage !== 'undefined') {
            const KEY = 'GameSessionCache';
            const cache = JSON.parse(localStorage.getItem(KEY) || '[]');
            const filtered = Array.isArray(cache)
                ? cache.filter(entry => entry && entry.id !== sessionId)
                : [];
            filtered.push({ id: sessionId, ...sessionData });
            localStorage.setItem(KEY, JSON.stringify(filtered));
            localStorage.setItem(`gameSession_${sessionId}`, JSON.stringify(sessionData));
            console.log('GameSession saved to localStorage:', sessionId);
        }

        if (typeof refreshTeacherViewIfNeeded === 'function') {
            refreshTeacherViewIfNeeded();
        }

        return { ok: true, id: sessionId, data: sessionData };
    } catch (err) {
        console.error('Error saveGameSession:', err);
        return { ok: false, error: String(err?.message || err) };
    }
}

// Save all user answers to Firebase UserAnswer collection
async function saveAllUserAnswers() {
    try {
        const now = new Date().toISOString();
        const safeUser = (typeof gameState === 'object' && gameState?.currentUser) ? gameState.currentUser : {};

        const safeTranslatedWords = (typeof gameState?.translatedWords === 'object' && gameState.translatedWords)
            ? gameState.translatedWords
            : {};
        const safeIncorrectWords = (typeof gameState?.incorrectWords === 'object' && gameState.incorrectWords)
            ? gameState.incorrectWords
            : {};

        const answersData = {
            userId: gameState?.userId || safeUser.uid || '',
            userName: safeUser.name || safeUser.displayName || 'Unknown',
            userEmail: safeUser.email || '',
            studentId: safeUser.studentId || '',

            gameId: gameState?.gameId || null,
            currentStep: Number(gameState?.currentStep ?? 0),

            comprehensionAnswers: Array.isArray(gameState?.comprehensionAnswers)
                ? gameState.comprehensionAnswers
                : [],
            comprehensionScore: Number(gameState?.comprehensionScore ?? 0),

            translatedWords: safeTranslatedWords,
            incorrectWords: safeIncorrectWords,
            wordAttempts: (typeof gameState?.wordAttempts === 'object' && gameState.wordAttempts)
                ? gameState.wordAttempts
                : {},

            imaginationText: gameState?.imaginationText || '',
            interpretationText: gameState?.interpretationText || '',

            matchingScore: Number(gameState?.matchingScore ?? 0),
            matchedPairs: Number(gameState?.matchedPairs ?? 0),

            vocabularyAnswers: Object.keys(safeTranslatedWords).map(wordKey => ({
                word: wordKey,
                userAnswer: safeTranslatedWords[wordKey]?.translation || '',
                correctAnswer: MISSION_DATA?.MISSION_01?.hardWords?.[wordKey]?.meaning || '',
                reference: safeTranslatedWords[wordKey]?.reference || '',
                points: Number(safeTranslatedWords[wordKey]?.points ?? 0),
                timestamp: safeTranslatedWords[wordKey]?.timestamp || now,
                isCorrect: true,
            })),
            incorrectAttempts: Object.keys(safeIncorrectWords).map(wordKey => ({
                word: wordKey,
                userAnswer: safeIncorrectWords[wordKey]?.translation || '',
                correctAnswer: MISSION_DATA?.MISSION_01?.hardWords?.[wordKey]?.meaning || '',
                reference: safeIncorrectWords[wordKey]?.reference || '',
                timestamp: safeIncorrectWords[wordKey]?.timestamp || now,
                isCorrect: false,
            })),

            missionId: 'MISSION_01',
            missionTitle: 'โคลงสี่สุภาพ - พระราชพงศาวดาร',

            timestamp: now,
            lastUpdated: now,
        };

        const answersDocId = `${answersData.userId || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

        if (!answersData.userId) {
            console.warn('saveAllUserAnswers: missing userId, storing locally');
        }

        if (typeof db !== 'undefined' && db && answersData.userId) {
            await db.collection('UserAnswer').doc(answersDocId).set(answersData);
            console.log('All user answers saved to Firestore:', answersDocId);
        } else {
            const KEY = 'UserAnswerCache';
            const cache = JSON.parse(localStorage.getItem(KEY) || '[]');
            cache.push({ id: answersDocId, ...answersData });
            localStorage.setItem(KEY, JSON.stringify(cache));
            console.log('All user answers saved to localStorage:', answersDocId);
        }

        if (typeof refreshTeacherViewIfNeeded === 'function') {
            refreshTeacherViewIfNeeded();
        }

        return { ok: true, id: answersDocId, data: answersData };
    } catch (error) {
        console.error('Error saving user answers:', error);
        return { ok: false, error: String(error?.message || error) };
    }
}

// Calculate current score
function calculateCurrentScore() {
    let vocabularyScore = 0;
    Object.values(gameState.translatedWords).forEach(word => {
        vocabularyScore += word.points;
    });

    const comprehensionScore = gameState.comprehensionScore * 20;
    const timeElapsed = (Date.now() - gameState.startTime) / 1000 / 60;
    const timeBonus = Math.max(0, Math.floor(50 - timeElapsed * 2));

    return vocabularyScore + comprehensionScore + timeBonus;
}

async function loadGameSession(gameId) {
    if (!gameId) return null;
    try {
        if (db) {
            try {
                const doc = await db.collection('gameSessions').doc(gameId).get();
                if (doc.exists) {
                    return doc.data();
                }
            } catch (legacyError) {
                console.warn('Legacy gameSessions lookup failed', legacyError);
            }

            try {
                const altDoc = await db.collection('GameSession').doc(gameId).get();
                if (altDoc.exists) {
                    return altDoc.data();
                }
            } catch (primaryError) {
                console.warn('GameSession lookup failed', primaryError);
            }
        }

        if (typeof localStorage !== 'undefined') {
            const cacheValue = localStorage.getItem('GameSessionCache');
            if (cacheValue) {
                try {
                    const parsed = JSON.parse(cacheValue);
                    if (Array.isArray(parsed)) {
                        const cached = parsed.find(entry => entry && entry.id === gameId);
                        if (cached) {
                            return cached;
                        }
                    }
                } catch (cacheError) {
                    console.error('Failed to read GameSessionCache entry', cacheError);
                }
            }

            const localData = localStorage.getItem(`gameSession_${gameId}`);
            if (localData) {
                return JSON.parse(localData);
            }
        }
    } catch (error) {
        console.error('Error loading game session:', error);
    }

    return null;
}

// Authentication Functions
async function signInWithGoogle() {
    try {
        if (auth) {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            const user = result.user;

            gameState.userId = user.uid;
            gameState.currentUser = {
                name: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                isGoogle: true
            };

            // Load or create user profile
            let userData = await loadUserData(user.uid);
            if (!userData) {
                userData = {
                    name: user.displayName,
                    email: user.email,
                    photoURL: user.photoURL,
                    registeredAt: new Date().toISOString(),
                    exp: 0,
                    rank: 'มือใหม่',
                    level: 1,
                    totalGamesPlayed: 0,
                    bestScore: 0,
                    isGoogle: true
                };
                await saveUserData(userData);
            }

            // Update player profile
            playerProfile.exp = userData.exp || 0;
            playerProfile.rank = userData.rank || 'มือใหม่';
            playerProfile.level = userData.level || 1;
            playerProfile.totalGamesPlayed = userData.totalGamesPlayed || 0;
            playerProfile.bestScore = userData.bestScore || 0;

            updateLoginUI({
                displayName: user.displayName,
                email: user.email,
                photoURL: user.photoURL,
                isGoogle: true,
                userData: userData
            });

            updateUserNameDisplay();
            showNotification(`ยินดีต้อนรับ ${user.displayName}!`, 'success');
        } else {
            showNotification('ระบบล็อกอิน Google ไม่พร้อมใช้งานในสภาพแวดล้อมนี้', 'error');
        }
    } catch (error) {
        console.error('Google sign-in error:', error);
        showNotification('เกิดข้อผิดพลาดในการเข้าสู่ระบบ', 'error');
    }
}

async function signOutUser() {
    try {
        // Save current game state before signing out
        if (gameState.gameId && gameState.userId) {
            await saveCurrentGameState();
            await saveAllUserAnswers();
        }

        // Clear user data
        gameState.userId = null;
        gameState.currentUser = null;
        localStorage.removeItem('lastStudentId');

        // Reset game state
        gameState.currentStep = 1;
        gameState.maxStepReached = 1;
        gameState.translatedWords = {};
        gameState.incorrectWords = {};
        gameState.imaginationText = '';
        gameState.interpretationText = '';
        gameState.comprehensionScore = 0;
        gameState.startTime = Date.now();
        gameState.selectedWord = null;
        gameState.stepHistory = [];
        gameState.comprehensionAnswers = [];
        gameState.gameId = null;

        // Update UI
        updateLoginUI(null);
        showNotification('ออกจากระบบเรียบร้อย', 'success');

    } catch (error) {
        console.error('Error signing out:', error);
        // Still proceed with sign out even if save fails
        gameState.userId = null;
        gameState.currentUser = null;
        localStorage.removeItem('lastStudentId');
        updateLoginUI(null);
        showNotification('ออกจากระบบเรียบร้อย', 'success');
    }
}

// Student Management Functions
function showStudentForm() {
    const loginButtons = document.getElementById('loginButtons');
    const studentForm = document.getElementById('studentForm');
    const userInfo = document.getElementById('userInfo');
    if (loginButtons) {
        loginButtons.classList.add('hidden');
    }
    if (studentForm) {
        studentForm.classList.remove('hidden');
    }
    if (userInfo && isEditingStudentProfile) {
        userInfo.classList.add('hidden');
    }
    const startWrapper = document.getElementById('startButtonWrapper');
    if (startWrapper) startWrapper.classList.add('hidden');
}

function hideStudentForm() {
    const loginButtons = document.getElementById('loginButtons');
    const studentForm = document.getElementById('studentForm');
    const userInfo = document.getElementById('userInfo');
    if (loginButtons && !gameState.currentUser) {
        loginButtons.classList.remove('hidden');
    }
    if (studentForm) {
        studentForm.classList.add('hidden');
    }
    if (userInfo && gameState.currentUser) {
        userInfo.classList.remove('hidden');
    }
    const startWrapper = document.getElementById('startButtonWrapper');
    if (startWrapper) startWrapper.classList.remove('hidden');
    clearStudentForm();
}

function showLoginForm() {
    document.getElementById('loginButtons').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    const startWrapper = document.getElementById('startButtonWrapper');
    if (startWrapper) startWrapper.classList.add('hidden');
}

function hideLoginForm() {
    document.getElementById('loginButtons').classList.remove('hidden');
    document.getElementById('loginForm').classList.add('hidden');
    const startWrapper = document.getElementById('startButtonWrapper');
    if (startWrapper) startWrapper.classList.remove('hidden');
    clearLoginForm();
}

function clearStudentForm() {
    document.getElementById('studentName').value = '';
    document.getElementById('studentId').value = '';
    document.getElementById('studentGrade').value = '';
    document.getElementById('studentRoom').value = '';
    document.getElementById('studentNumber').value = '';
    document.getElementById('studentPhone').value = '';
    const studentIdInput = document.getElementById('studentId');
    if (studentIdInput) {
        studentIdInput.disabled = false;
    }
    const submitButton = document.getElementById('studentFormSubmitButton');
    if (submitButton) {
        submitButton.textContent = 'บันทึกข้อมูล';
        submitButton.dataset.mode = 'create';
    }
    isEditingStudentProfile = false;
    editingStudentId = null;
}

function clearLoginForm() {
    document.getElementById('loginStudentId').value = '';
    document.getElementById('loginPhone').value = '';
}

function openStudentEdit() {
    const currentUser = gameState?.currentUser;
    const activeUserId = gameState?.userId;
    if (!currentUser || !activeUserId) {
        showNotification('กรุณาเข้าสู่ระบบก่อนแก้ไขข้อมูล', 'error');
        return;
    }

    isEditingStudentProfile = true;
    editingStudentId = currentUser.studentId || activeUserId;

    showStudentForm();

    const nameInput = document.getElementById('studentName');
    const idInput = document.getElementById('studentId');
    const gradeSelect = document.getElementById('studentGrade');
    const roomInput = document.getElementById('studentRoom');
    const numberInput = document.getElementById('studentNumber');
    const phoneInput = document.getElementById('studentPhone');
    const submitButton = document.getElementById('studentFormSubmitButton');

    if (nameInput) nameInput.value = currentUser.name || currentUser.displayName || '';
    if (idInput) {
        idInput.value = editingStudentId || '';
        idInput.disabled = true;
    }
    if (gradeSelect) gradeSelect.value = currentUser.grade || '';
    if (roomInput) roomInput.value = currentUser.room || '';
    if (numberInput) numberInput.value = currentUser.number || '';
    if (phoneInput) phoneInput.value = currentUser.phone || '';
    if (submitButton) {
        submitButton.textContent = 'บันทึกการแก้ไข';
        submitButton.dataset.mode = 'edit';
    }
}

async function openStudentHistory() {
    const activeUserId = gameState?.userId;
    if (!activeUserId) {
        showNotification('กรุณาเข้าสู่ระบบเพื่อดูประวัติการเล่น', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'studentHistoryModal';
    modal.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';

    const modalCard = document.createElement('div');
    modalCard.className = 'modal-card scrollable bg-white rounded-3xl p-6 md:p-8 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative';

    modalCard.innerHTML = `
        <button type="button" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600" aria-label="ปิด" onclick="closeStudentHistoryModal()">
            ✕
        </button>
        <div class="space-y-4">
            <div>
                <h2 class="text-xl font-bold text-slate-900">📒 บันทึกการเรียนรู้ของฉัน</h2>
                <p class="text-sm text-slate-500">ดูคะแนนและภารกิจที่คุณได้บันทึกไว้ในระบบ</p>
            </div>
            <div id="studentHistoryContent" class="space-y-3">
                <div class="text-center text-sm text-slate-500">กำลังโหลดข้อมูล...</div>
            </div>
        </div>
    `;

    modal.appendChild(modalCard);
    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeStudentHistoryModal();
        }
    });

    document.body.appendChild(modal);
    incrementModalCount();

    const container = modalCard.querySelector('#studentHistoryContent');
    await populateStudentHistoryContent(container);
}

async function populateStudentHistoryContent(container) {
    if (!container) return;

    const activeUserId = gameState?.userId;
    if (!activeUserId) {
        container.innerHTML = '<p class="text-sm text-center text-slate-500">กรุณาเข้าสู่ระบบเพื่อดูบันทึกการเรียนรู้</p>';
        return;
    }

    container.innerHTML = '<div class="text-center text-sm text-slate-500">กำลังโหลดข้อมูล...</div>';

    try {
        const sessions = await fetchStudentSessionsByUser(activeUserId);

        if (!sessions.length) {
            container.innerHTML = '<p class="text-sm text-center text-slate-500">ยังไม่มีบันทึกการเล่นในระบบ</p>';
            return;
        }

        const totalScore = sessions.reduce((sum, session) => sum + (Number(session.totalScore) || Number(session.comprehensionScore) || 0), 0);
        const completedCount = sessions.filter(session => session.completed).length;

        const header = `
            <div class="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-700">
                <p class="font-semibold">สรุปภาพรวม</p>
                <p class="mt-1">บันทึกทั้งหมด ${sessions.length} ครั้ง • คะแนนรวม ${totalScore.toLocaleString('th-TH')} แต้ม • ปิดภารกิจแล้ว ${completedCount} ครั้ง</p>
            </div>
        `;

        const items = sessions.map(session => {
            const updated = formatDateTime(session.lastUpdatedAt || session.timestampAt || session.lastUpdated || session.timestamp);
            const score = Math.round(Number(session.totalScore) || Number(session.comprehensionScore) || 0).toLocaleString('th-TH');
            const stepLabel = getStepLabel(session.currentStep);
            const status = session.completed ? 'เสร็จสิ้นภารกิจ' : `กำลังเรียนรู้: ${stepLabel}`;
            const sessionKey = encodeURIComponent(getSessionIdentifier(session, session.sessionKey || ''));
            const docId = encodeURIComponent(session.id || session.docId || session.recordId || '');
            const timestamp = encodeURIComponent(session.timestamp || session.lastUpdated || '');
            const gameId = encodeURIComponent(session.gameId || '');
            return `
                <div class="rounded-2xl border border-slate-200 bg-white/90 p-4 flex flex-col gap-3 shadow-sm student-history-item" data-session-key="${sessionKey}">
                    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span class="font-semibold text-slate-900">${status}</span>
                        <span class="text-xs text-slate-500">${updated}</span>
                    </div>
                    <div class="text-sm text-slate-600">คะแนนสะสม ${score} แต้ม • ขั้นปัจจุบัน ${stepLabel}</div>
                    <div class="flex justify-end">
                        <button type="button" class="student-history-delete text-xs font-semibold text-rose-600 hover:text-rose-700 transition" data-session="${sessionKey}" data-doc="${docId}" data-timestamp="${timestamp}" data-game-id="${gameId}">
                            ลบบันทึก
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = header + items;
        attachStudentHistoryDeleteHandlers(container);
    } catch (error) {
        console.error('Failed to load student history', error);
        container.innerHTML = '<p class="text-sm text-center text-rose-500">ไม่สามารถโหลดบันทึกได้ กรุณาลองใหม่อีกครั้ง</p>';
    }
}

function attachStudentHistoryDeleteHandlers(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('.student-history-delete');
    buttons.forEach(button => {
        if (!button || button.dataset.bound === 'true') return;
        button.dataset.bound = 'true';
        button.addEventListener('click', async () => {
            const activeUserId = gameState?.userId;
            if (!activeUserId) {
                showNotification('กรุณาเข้าสู่ระบบก่อนลบบันทึก', 'error');
                return;
            }

            if (!confirm('ต้องการลบบันทึกการเรียนรู้นี้หรือไม่?')) {
                return;
            }

            const rawSessionKey = button.dataset.session ? decodeURIComponent(button.dataset.session) : '';
            const rawDocId = button.dataset.doc ? decodeURIComponent(button.dataset.doc) : '';
            const rawTimestamp = button.dataset.timestamp ? decodeURIComponent(button.dataset.timestamp) : '';
            const rawGameId = button.dataset.gameId ? decodeURIComponent(button.dataset.gameId) : '';

            button.disabled = true;
            button.classList.add('opacity-60');

            const result = await deleteStudentHistoryRecord({
                userId: activeUserId,
                sessionKey: rawSessionKey,
                docId: rawDocId,
                timestamp: rawTimestamp,
                gameId: rawGameId
            });

            button.disabled = false;
            button.classList.remove('opacity-60');

            if (result.ok) {
                showNotification('ลบบันทึกแล้ว', 'success');
                await populateStudentHistoryContent(container);
            } else {
                showNotification('ไม่สามารถลบบันทึกได้', 'error');
            }
        });
    });
}

async function deleteStudentHistoryRecord({ userId, sessionKey, docId, timestamp, gameId }) {
    const identifiers = new Set();
    [sessionKey, docId, timestamp, gameId]
        .filter(value => typeof value === 'string' && value.trim() !== '')
        .forEach(value => identifiers.add(value.trim()));

    if (timestamp && userId) {
        identifiers.add(`${userId}_${timestamp}`);
    }

    if (!identifiers.size) {
        console.warn('ไม่มีรหัสระบุสำหรับการลบบันทึกนักเรียน');
        return { ok: false };
    }

    try {
        if (db && identifiers.size) {
            const deletions = [];
            identifiers.forEach(id => {
                deletions.push(db.collection('GameSession').doc(id).delete().catch(() => null));
                deletions.push(db.collection('gameSessions').doc(id).delete().catch(() => null));
            });
            await Promise.all(deletions);
        }
    } catch (error) {
        console.warn('ไม่สามารถลบข้อมูลจาก Firestore ได้', error);
    }

    if (typeof localStorage !== 'undefined') {
        const matchEntry = (entry) => {
            if (!entry) return false;
            const values = [
                getSessionIdentifier(entry, ''),
                entry.id,
                entry.sessionKey,
                entry.gameId,
                entry.docId,
                entry.recordId,
                entry.timestamp,
                entry.lastUpdated
            ].filter(Boolean).map(value => String(value));

            if (userId && (entry.userId === userId || entry.studentId === userId)) {
                const stamp = entry.timestamp || entry.lastUpdated || '';
                if (stamp) {
                    values.push(`${entry.userId || entry.studentId}_${stamp}`);
                }
            }

            return values.some(value => identifiers.has(value));
        };

        try {
            const cacheKey = 'GameSessionCache';
            const cacheValue = localStorage.getItem(cacheKey);
            if (cacheValue) {
                const parsed = JSON.parse(cacheValue);
                if (Array.isArray(parsed)) {
                    const filtered = parsed.filter(entry => !matchEntry(entry));
                    localStorage.setItem(cacheKey, JSON.stringify(filtered));
                }
            }
        } catch (error) {
            console.error('ล้างข้อมูล GameSessionCache ไม่สำเร็จ', error);
        }

        try {
            const removalKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const keyName = localStorage.key(i);
                if (!keyName || !keyName.startsWith('gameSession_')) continue;
                const value = localStorage.getItem(keyName);
                if (!value) continue;
                try {
                    const parsed = JSON.parse(value);
                    if (matchEntry(parsed)) {
                        removalKeys.push(keyName);
                    }
                } catch (error) {
                    console.error('อ่านข้อมูล gameSession ล้มเหลว', error);
                }
            }
            removalKeys.forEach(key => localStorage.removeItem(key));
        } catch (error) {
            console.error('ไม่สามารถลบข้อมูล gameSession_* ได้', error);
        }
    }

    if (Array.isArray(teacherDashboardState.sessions) && teacherDashboardState.sessions.length) {
        teacherDashboardState.sessions = teacherDashboardState.sessions.filter(session => {
            const values = [
                getSessionIdentifier(session, ''),
                session.id,
                session.sessionKey,
                session.gameId,
                session.docId,
                session.recordId,
                session.timestamp,
                session.lastUpdated
            ].filter(Boolean).map(value => String(value));
            return !values.some(value => identifiers.has(value));
        });
    }

    if (typeof refreshTeacherViewIfNeeded === 'function') {
        refreshTeacherViewIfNeeded();
    }

    return { ok: true };
}

function closeStudentHistoryModal() {
    const modal = document.getElementById('studentHistoryModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

async function registerStudent() {
    const name = document.getElementById('studentName').value.trim();
    const studentIdInput = document.getElementById('studentId');
    const rawStudentId = studentIdInput ? studentIdInput.value.trim() : '';
    const grade = document.getElementById('studentGrade').value;
    const room = document.getElementById('studentRoom').value.trim();
    const number = document.getElementById('studentNumber').value.trim();
    const phone = document.getElementById('studentPhone').value.trim();

    const isEditing = isEditingStudentProfile && !!gameState?.userId;
    const targetStudentId = isEditing ? (editingStudentId || gameState.userId || rawStudentId) : rawStudentId;

    // Validation
    if (!name || !targetStudentId || !grade || !room || !number || !phone) {
        showNotification('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
        return;
    }

    if (phone.length < 10) {
        showNotification('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง', 'error');
        return;
    }

    const timestamp = new Date().toISOString();
    const baseData = isEditing ? { ...(gameState.currentUser || {}) } : {};

    const studentData = {
        ...baseData,
        name,
        studentId: targetStudentId,
        grade,
        room,
        number,
        phone,
        updatedAt: timestamp,
        registeredAt: baseData.registeredAt || timestamp,
        exp: typeof baseData.exp === 'number' ? baseData.exp : 0,
        rank: baseData.rank || 'มือใหม่',
        level: typeof baseData.level === 'number' ? baseData.level : 1,
        totalGamesPlayed: typeof baseData.totalGamesPlayed === 'number' ? baseData.totalGamesPlayed : 0,
        bestScore: typeof baseData.bestScore === 'number' ? baseData.bestScore : 0,
        isStudent: true
    };

    try {
        // Set current user
        gameState.userId = targetStudentId;
        gameState.currentUser = studentData;

        // Save to database
        await saveUserData(studentData);

        // Save last student ID for auto-login
        localStorage.setItem('lastStudentId', targetStudentId);

        // Update player profile
        playerProfile.exp = typeof studentData.exp === 'number' ? studentData.exp : (playerProfile.exp || 0);
        playerProfile.rank = studentData.rank || playerProfile.rank || 'มือใหม่';
        playerProfile.level = typeof studentData.level === 'number' ? studentData.level : (playerProfile.level || 1);
        playerProfile.totalGamesPlayed = typeof studentData.totalGamesPlayed === 'number' ? studentData.totalGamesPlayed : (playerProfile.totalGamesPlayed || 0);
        playerProfile.bestScore = typeof studentData.bestScore === 'number' ? studentData.bestScore : (playerProfile.bestScore || 0);

        // Update UI
        updateLoginUI({
            displayName: name,
            email: `${grade}/${room} เลขที่ ${number}`,
            photoURL: '',
            isStudent: true,
            studentData: studentData
        });

        updateUserNameDisplay();
        showNotification(isEditing ? 'บันทึกการแก้ไขโปรไฟล์แล้ว' : 'บันทึกข้อมูลเรียบร้อย!', 'success');
        hideStudentForm();

    } catch (error) {
        console.error('Registration error:', error);
        showNotification('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
    }
}

async function loginStudent() {
    const studentId = document.getElementById('loginStudentId').value.trim();
    const phone = document.getElementById('loginPhone').value.trim();

    if (!studentId || !phone) {
        showNotification('กรุณากรอกรหัสนักเรียนและเบอร์โทรศัพท์', 'error');
        return;
    }

    try {
        // Try to load from database first
        let studentData = await loadUserData(studentId);

        if (!studentData) {
            showNotification('ไม่พบข้อมูลนักเรียน', 'error');
            return;
        }

        // Verify phone number
        if (studentData.phone !== phone) {
            showNotification('เบอร์โทรศัพท์ไม่ถูกต้อง', 'error');
            return;
        }

        // Set current user
        gameState.userId = studentId;
        gameState.currentUser = studentData;

        // Save last student ID for auto-login
        localStorage.setItem('lastStudentId', studentId);

        // Update player profile
        playerProfile.exp = studentData.exp || 0;
        playerProfile.rank = studentData.rank || 'มือใหม่';
        playerProfile.level = studentData.level || 1;
        playerProfile.totalGamesPlayed = studentData.totalGamesPlayed || 0;
        playerProfile.bestScore = studentData.bestScore || 0;

        // Update UI
        updateLoginUI({
            displayName: studentData.name,
            email: `${studentData.grade}/${studentData.room} เลขที่ ${studentData.number}`,
            photoURL: '',
            isStudent: true,
            studentData: studentData
        });

        showNotification(`ยินดีต้อนรับ ${studentData.name}!`, 'success');
        hideLoginForm();

    } catch (error) {
        console.error('Login error:', error);
        showNotification('เกิดข้อผิดพลาดในการเข้าสู่ระบบ', 'error');
    }
}

function updateLoginUI(user) {
    const loginButtons = document.getElementById('loginButtons');
    const studentForm = document.getElementById('studentForm');
    const loginForm = document.getElementById('loginForm');
    const userInfo = document.getElementById('userInfo');
    const startGameBtn = document.getElementById('startGameBtn');
    const startWrapper = document.getElementById('startButtonWrapper');
    const startHint = document.getElementById('startButtonHint');
    const landingPage = document.getElementById('landingPage');
    const teacherCta = document.getElementById('teacherLoginCta');
    const footer = document.getElementById('siteFooter');

    if (user) {
        // Hide all forms
        if (loginButtons) loginButtons.classList.add('hidden');
        if (studentForm) studentForm.classList.add('hidden');
        if (loginForm) loginForm.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');
        if (startGameBtn) startGameBtn.disabled = false;
        if (startWrapper) startWrapper.classList.remove('hidden');
        if (startHint) {
            startHint.textContent = 'พร้อมเริ่มภารกิจได้เลย';
            startHint.classList.remove('text-slate-600/80');
            startHint.classList.add('text-emerald-700/80');
        }
        if (teacherCta) teacherCta.classList.add('hidden');
        if (footer) footer.classList.remove('hidden');

        // Add class to make background more transparent when logged in
        if (landingPage) landingPage.classList.add('user-logged-in');

        // Update user info
        const userName = document.getElementById('userName');
        const userDetails = document.getElementById('userDetails');
        const userStats = document.getElementById('userStats');
        const userPhoto = document.getElementById('userPhoto');

        if (userName) userName.textContent = user.displayName;
        if (userDetails) userDetails.textContent = user.email;
        if (userStats) userStats.textContent = `EXP: ${playerProfile.exp} | เกม: ${playerProfile.totalGamesPlayed}`;

        // Set student avatar
        if (userPhoto) {
            userPhoto.src = DEFAULT_AVATAR;
        }

        gameState.userId = gameState.userId;
    } else {
        // Show login options
        if (loginButtons) loginButtons.classList.remove('hidden');
        if (studentForm) studentForm.classList.add('hidden');
        if (loginForm) loginForm.classList.add('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        if (startGameBtn) startGameBtn.disabled = true;
        if (startWrapper) startWrapper.classList.remove('hidden');
        if (startHint) {
            startHint.textContent = 'เข้าสู่ระบบก่อนเพื่อเปิดภารกิจ';
            startHint.classList.remove('text-emerald-700/80');
            startHint.classList.add('text-slate-600/80');
        }
        if (teacherCta) teacherCta.classList.remove('hidden');
        if (footer) footer.classList.add('hidden');

        // Remove class to show background clearly when not logged in
        if (landingPage) landingPage.classList.remove('user-logged-in');

        gameState.userId = null;
        gameState.currentUser = null;
    }
}

function openTeacherPortal() {
    const portal = document.getElementById('teacherPortal');
    const landing = document.getElementById('landingPage');
    const footer = document.getElementById('siteFooter');
    const stepBar = document.getElementById('stepUtilityBar');
    const playerBar = document.getElementById('playerStatusBar');
    const floatingActions = document.getElementById('floatingActionButtons');
    if (!portal) return;

    portal.classList.remove('hidden');
    if (landing) landing.classList.add('hidden');
    if (footer) footer.classList.remove('hidden');
    if (stepBar) stepBar.classList.add('hidden');
    if (playerBar) playerBar.classList.add('hidden');
    if (floatingActions) {
        floatingActions.classList.add('hidden');
        floatingActions.classList.remove('show');
        floatingActions.setAttribute('aria-hidden', 'true');
    }
    closeTeacherStudentModal();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const loginPanel = document.getElementById('teacherLoginPanel');
    const dashboard = document.getElementById('teacherDashboard');

    if (currentTeacher) {
        if (loginPanel) loginPanel.classList.add('hidden');
        if (dashboard) dashboard.classList.remove('hidden');
        renderTeacherDashboard();
    } else {
        if (loginPanel) loginPanel.classList.remove('hidden');
        if (dashboard) dashboard.classList.add('hidden');
        resetTeacherLoginForm();
    }
}

function closeTeacherPortal() {
    const portal = document.getElementById('teacherPortal');
    const landing = document.getElementById('landingPage');
    const footer = document.getElementById('siteFooter');
    const stepBar = document.getElementById('stepUtilityBar');
    const playerBar = document.getElementById('playerStatusBar');
    const floatingActions = document.getElementById('floatingActionButtons');
    if (!portal) return;

    portal.classList.add('hidden');
    if (landing) landing.classList.remove('hidden');
    if (footer) {
        if (gameState.userId) {
            footer.classList.remove('hidden');
        } else {
            footer.classList.add('hidden');
        }
    }
    closeTeacherStudentModal();
    if (stepBar || playerBar) {
        const landingVisible = landing ? !landing.classList.contains('hidden') : false;
        const shouldShowPlayer = gameState.userId && !landingVisible;
        if (stepBar) stepBar.classList.toggle('hidden', !shouldShowPlayer);
        if (playerBar) playerBar.classList.toggle('hidden', !shouldShowPlayer);
        if (floatingActions) {
            floatingActions.classList.toggle('hidden', !shouldShowPlayer);
            if (!shouldShowPlayer) {
                floatingActions.classList.remove('show');
            }
            floatingActions.setAttribute('aria-hidden', (!shouldShowPlayer).toString());
        }
    }
}

function resetTeacherLoginForm() {
    const emailInput = document.getElementById('teacherEmail');
    const passwordInput = document.getElementById('teacherPassword');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

async function submitTeacherLogin(event) {
    event.preventDefault();

    const emailInput = document.getElementById('teacherEmail');
    const passwordInput = document.getElementById('teacherPassword');

    const email = emailInput?.value.trim().toLowerCase();
    const password = passwordInput?.value.trim();

    if (!email || !password) {
        showNotification('กรุณากรอกอีเมลและรหัสผ่านของคุณครู', 'error');
        return;
    }

    const credential = teacherCredentials[email];
    if (!credential) {
        showNotification('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
        if (passwordInput) passwordInput.value = '';
        return;
    }

    const inputHash = await hashPasscode(password);
    const expectedPasscode = reconstructPasscode(credential);
    let isValid = false;

    if (expectedPasscode) {
        const expectedHash = await hashPasscode(expectedPasscode);
        isValid = expectedHash === inputHash;
    } else if (typeof credential.passcodeHash === 'string' && credential.passcodeHash.length > 0) {
        isValid = credential.passcodeHash === inputHash;
    }

    if (!isValid) {
        showNotification('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
        if (passwordInput) passwordInput.value = '';
        return;
    }

    const { passcodeSegments, passcode, passcodeHash, ...safeCredential } = credential;
    currentTeacher = {
        email,
        ...safeCredential
    };

    const loginPanel = document.getElementById('teacherLoginPanel');
    const dashboard = document.getElementById('teacherDashboard');

    if (loginPanel) loginPanel.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');

    showNotification(`ยินดีต้อนรับ ${credential.name}`, 'success');
    await renderTeacherDashboard();
}

function logoutTeacher() {
    currentTeacher = null;
    const loginPanel = document.getElementById('teacherLoginPanel');
    const dashboard = document.getElementById('teacherDashboard');
    if (loginPanel) loginPanel.classList.remove('hidden');
    if (dashboard) dashboard.classList.add('hidden');
    resetTeacherLoginForm();
    showNotification('ออกจากระบบครูเรียบร้อย', 'success');
}


async function renderTeacherDashboard() {
    const loading = document.getElementById('teacherDashboardLoading');
    const summary = document.getElementById('teacherSummaryCards');
    const tableBody = document.getElementById('teacherStudentTable');
    const timeline = document.getElementById('teacherActivityTimeline');
    const emptyState = document.getElementById('teacherEmptyState');
    const tableMeta = document.getElementById('teacherTableMeta');
    const timelineMeta = document.getElementById('teacherTimelineMeta');
    const rankingContainer = document.getElementById('teacherRankingSummary');
    const rankingMeta = document.getElementById('teacherRankingMeta');
    const quickTotal = document.getElementById('teacherQuickTotal');
    const quickAverage = document.getElementById('teacherQuickAverage');
    const quickStudents = document.getElementById('teacherQuickStudents');
    const quickCompleted = document.getElementById('teacherQuickCompleted');
    const quickActive = document.getElementById('teacherQuickActive');
    const greeting = document.getElementById('teacherGreeting');
    const classesEl = document.getElementById('teacherClasses');
    const emailEl = document.getElementById('teacherEmailDisplay');

    try {
        if (currentTeacher) {
            if (greeting) greeting.textContent = `ยินดีต้อนรับ ${currentTeacher.name}`;
            if (classesEl) classesEl.textContent = currentTeacher.classes?.length ? `ดูแล: ${currentTeacher.classes.join(', ')}` : 'บัญชีครูภาษาไทย';
            if (emailEl) emailEl.textContent = `${currentTeacher.role || 'ครูผู้สอน'} • ${currentTeacher.email}`;
        }

        if (summary) summary.innerHTML = '';
        if (tableBody) tableBody.innerHTML = '';
        if (timeline) timeline.innerHTML = '';
        if (tableMeta) tableMeta.textContent = '';
        if (timelineMeta) timelineMeta.textContent = '';
        if (emptyState) emptyState.classList.add('hidden');

        if (loading) loading.classList.remove('hidden');

        const { students, sessions } = await fetchTeacherData();

        if (loading) loading.classList.add('hidden');

        const studentRows = buildStudentRows(students, sessions);
        const completedSessions = sessions.filter(session => session.completed);
        const totalScore = sessions.reduce((sum, session) => sum + (Number(session.totalScore) || 0), 0);
        const averageScore = sessions.length ? Math.round(totalScore / sessions.length) : 0;
        const activeToday = sessions.filter(session => {
            const activityDate = session.lastUpdatedAt || session.timestampAt || session.lastUpdated || session.timestamp;
            const parsed = parseDate(activityDate);
            if (!parsed) return false;
            const now = new Date();
            return parsed.getFullYear() === now.getFullYear() && parsed.getMonth() === now.getMonth() && parsed.getDate() === now.getDate();
        });

        if (quickTotal) quickTotal.textContent = totalScore ? totalScore.toLocaleString('th-TH') : '0';
        if (quickAverage) quickAverage.textContent = sessions.length ? `${averageScore}` : '0';
        if (quickCompleted) quickCompleted.textContent = completedSessions.length.toString();
        if (quickActive) quickActive.textContent = activeToday.length.toString();
        if (quickStudents) quickStudents.textContent = studentRows.length.toString();

        if (studentRows.length === 0 && sessions.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        const sortedStudentRows = [...studentRows].sort((a, b) => {
            const totalDiff = (b.totalScore || 0) - (a.totalScore || 0);
            if (totalDiff !== 0) return totalDiff;
            const scoreDiff = (b.averageScore || 0) - (a.averageScore || 0);
            if (scoreDiff !== 0) return scoreDiff;

            const aDate = parseDate(a.latestSession?.lastUpdatedAt || a.latestSession?.timestampAt || a.latestSession?.lastUpdated || a.latestSession?.timestamp);
            const bDate = parseDate(b.latestSession?.lastUpdatedAt || b.latestSession?.timestampAt || b.latestSession?.lastUpdated || b.latestSession?.timestamp);
            return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
        });

        teacherDashboardState.students = students;
        teacherDashboardState.sessions = sessions;
        teacherDashboardState.rows = sortedStudentRows;
        resetTeacherStudentDetail();

        if (summary) {
            const inProgress = sessions.length - completedSessions.length;
            const summaryData = [
                {
                    label: 'คะแนนรวมทั้งหมด',
                    value: totalScore ? totalScore.toLocaleString('th-TH') : '0',
                    description: 'รวมคะแนนจากทุกกิจกรรมที่บันทึก',
                    gradient: 'from-amber-500 to-orange-500',
                    icon: '🏅'
                },
                {
                    label: 'นักเรียนที่ลงทะเบียน',
                    value: studentRows.length,
                    description: 'มีโปรไฟล์หรือบันทึกคะแนนในระบบ',
                    gradient: 'from-blue-500 to-indigo-500',
                    icon: '👨‍🎓'
                },
                {
                    label: 'ภารกิจที่เสร็จสมบูรณ์',
                    value: completedSessions.length,
                    description: 'ปิดจบครบทุกขั้น',
                    gradient: 'from-emerald-500 to-teal-500',
                    icon: '🏆'
                },
                {
                    label: 'กำลังทำอยู่',
                    value: Math.max(inProgress, 0),
                    description: 'อยู่ระหว่างภารกิจ',
                    gradient: 'from-sky-500 to-indigo-500',
                    icon: '⏳'
                },
                {
                    label: 'คะแนนเฉลี่ยรวม',
                    value: sessions.length ? `${averageScore}` : '0',
                    description: 'จากทุกเกมที่บันทึก',
                    gradient: 'from-purple-500 to-pink-500',
                    icon: '📊'
                }
            ];

            summary.innerHTML = summaryData.map(card => `
                <div class="teacher-summary-card bg-white border border-slate-200 rounded-3xl p-5 flex flex-col gap-3 shadow-sm">
                    <div class="flex items-center gap-3">
                        <span class="text-2xl">${card.icon}</span>
                        <div>
                            <p class="text-xs uppercase tracking-wide text-slate-500">${card.label}</p>
                            <p class="text-2xl font-bold text-slate-900">${card.value}</p>
                        </div>
                    </div>
                    <div class="mt-auto">
                        <div class="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                            <div class="h-full bg-gradient-to-r ${card.gradient}"></div>
                        </div>
                        <p class="text-xs text-slate-500 mt-2">${card.description}</p>
                    </div>
                </div>
            `).join('');
        }

        if (tableBody) {
            tableBody.innerHTML = sortedStudentRows.map(row => {
                const gradeRoom = row.grade ? `${row.grade}${row.room ? `/${row.room}` : ''}` : '-';
                const progressPercent = Math.min(100, Math.round(((row.latestSession?.currentStep || 1) / 6) * 100));
                const studentTotalScore = row.totalScore ? Math.round(row.totalScore) : 0;
                const latestScore = row.latestSession ? Math.round(Number(row.latestSession.totalScore) || Number(row.latestSession.comprehensionScore) || 0) : 0;
                const updatedAt = row.latestSession ? formatDateTime(row.latestSession.lastUpdatedAt || row.latestSession.timestampAt || row.latestSession.lastUpdated || row.latestSession.timestamp) : '-';
                const completionBadge = row.completionCount > 0 ? `<span class="px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700">เสร็จ ${row.completionCount} ครั้ง</span>` : `<span class="px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-700">กำลังทำ</span>`;

                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="px-4 py-3" data-label="นักเรียน">
                            <div class="flex flex-col">
                                <button type="button" data-student-key="${row.key || row.studentId}" class="teacher-student-link text-left font-semibold text-slate-900 hover:text-blue-600 focus:outline-none focus:text-blue-700 transition">
                                    ${row.name || 'ไม่ระบุชื่อ'}
                                </button>
                                <span class="text-xs text-slate-500">${row.studentId || '-'}</span>
                                <span class="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
                                    ${row.rankTier?.icon || '🌟'} ${row.rankTier?.label || 'มือใหม่'}
                                </span>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-slate-600" data-label="ชั้น/ห้อง">
                            <div class="flex flex-col gap-1">
                                <span>${gradeRoom}</span>
                                <span class="text-xs text-slate-500">เลขที่ ${row.number || '-'}</span>
                            </div>
                        </td>
                        <td class="px-4 py-3" data-label="ความคืบหน้า">
                            <div class="flex flex-col gap-1">
                                <div class="h-2.5 rounded-full bg-slate-200">
                                    <div class="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style="width: ${progressPercent}%"></div>
                                </div>
                                <div class="flex items-center justify-between text-xs text-slate-500">
                                    <span>${progressPercent}%</span>
                                    ${completionBadge}
                                </div>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-slate-600" data-label="คะแนนรวม">
                            <div class="flex flex-col gap-1">
                                <span class="font-semibold text-slate-900">${studentTotalScore.toLocaleString('th-TH')}</span>
                                <span class="text-xs text-slate-500">จาก ${row.sessions.length} ภารกิจ</span>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-slate-600" data-label="คะแนนเฉลี่ย">
                            <div class="flex flex-col gap-1">
                                <span class="font-semibold text-slate-900">${(row.averageScore || latestScore).toLocaleString('th-TH')}</span>
                                <span class="text-xs text-slate-500">ล่าสุด ${latestScore.toLocaleString('th-TH')}</span>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-slate-600 text-sm" data-label="อัปเดตล่าสุด">${updatedAt}</td>
                        <td class="px-4 py-3" data-label="การจัดการ">
                            <div class="flex flex-wrap gap-2">
                                <button type="button" class="teacher-edit-btn px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 text-xs font-semibold hover:bg-amber-200 transition" data-student-key="${row.key}">
                                    ✏️ แก้ไข
                                </button>
                                <button type="button" class="teacher-delete-btn px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-semibold hover:bg-rose-200 transition" data-student-key="${row.key}">
                                    🗑️ ลบ
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tableBody.querySelectorAll('.teacher-student-link').forEach(button => {
                button.addEventListener('click', () => {
                    const key = button.getAttribute('data-student-key');
                    showTeacherStudentDetail(key);
                });
            });

            tableBody.querySelectorAll('.teacher-edit-btn').forEach(button => {
                button.addEventListener('click', () => {
                    const key = button.getAttribute('data-student-key');
                    openTeacherEditStudent(key);
                });
            });

            tableBody.querySelectorAll('.teacher-delete-btn').forEach(button => {
                button.addEventListener('click', () => {
                    const key = button.getAttribute('data-student-key');
                    requestTeacherDeleteStudent(key);
                });
            });
        }

        if (tableMeta) {
            const totalRecordedScore = totalScore ? totalScore.toLocaleString('th-TH') : '0';
            tableMeta.textContent = `${sortedStudentRows.length} รายการ • คะแนนรวม ${totalRecordedScore} • อัปเดต ${formatDateTime(new Date())}`;
        }

        if (rankingContainer) {
            const tierStats = RANK_TIERS.map(tier => {
                const members = sortedStudentRows.filter(row => row.rankTier?.id === tier.id);
                const topMember = members.length
                    ? [...members].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))[0]
                    : null;
                return { tier, count: members.length, topMember };
            });

            rankingContainer.innerHTML = tierStats.map(({ tier, count, topMember }) => {
                const topLabel = topMember
                    ? ` • สูงสุด ${topMember.name || 'ไม่ระบุชื่อ'} (${Math.round(topMember.totalScore || 0).toLocaleString('th-TH')} แต้ม)`
                    : '';
                return `
                    <div class="teacher-rank-card">
                        <div class="rank-tier">${tier.icon} ${tier.label}</div>
                        <div class="text-2xl font-bold text-slate-900">${count.toLocaleString('th-TH')}</div>
                        <div class="rank-meta">${tier.description}${topLabel}</div>
                    </div>
                `;
            }).join('');
        }

        if (rankingMeta) {
            rankingMeta.textContent = `${sortedStudentRows.length} รายชื่อ • อัปเดต ${formatDateTime(new Date())}`;
        }

        if (timeline) {
            const recentActivities = [...sessions]
                .sort((a, b) => {
                    const aDate = parseDate(a.lastUpdatedAt || a.timestampAt || a.lastUpdated || a.timestamp);
                    const bDate = parseDate(b.lastUpdatedAt || b.timestampAt || b.lastUpdated || b.timestamp);
                    return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
                })
                .slice(0, 6);

            if (recentActivities.length === 0) {
                timeline.innerHTML = '<p class="text-sm text-slate-500 text-center">ยังไม่มีกิจกรรมล่าสุด</p>';
            } else {
                timeline.innerHTML = recentActivities.map((activity, index) => {
                    const activityTime = formatDateTime(activity.lastUpdatedAt || activity.timestampAt || activity.lastUpdated || activity.timestamp);
                    const status = activity.completed ? 'เสร็จสิ้นภารกิจ' : `อยู่ที่ขั้นตอน ${activity.currentStep || '-'}`;
                    const total = Math.round(Number(activity.totalScore) || Number(activity.comprehensionScore) || 0);
                    const initials = activity.userName ? activity.userName.trim().charAt(0) : 'น';
                    const activityKey = getSessionIdentifier(activity, `timeline_${index}`);

                    return `
                        <button type="button" class="teacher-activity-timeline-card flex gap-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-left w-full" data-session-key="${activityKey}">
                            <div class="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl">${initials}</div>
                            <div class="flex-1">
                                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <div>
                                        <p class="font-semibold text-slate-900">${activity.userName || 'นักเรียนไม่ระบุชื่อ'}</p>
                                        <p class="text-xs text-slate-500">${status}</p>
                                    </div>
                                    <div class="text-xs text-slate-500">${activityTime}</div>
                                </div>
                                <div class="mt-2 text-sm text-slate-600">คะแนนรวม ${total.toLocaleString('th-TH')} แต้ม</div>
                            </div>
                        </button>
                    `;
                }).join('');
                attachTeacherActivityCardHandlers(timeline);
            }
        }

        if (timelineMeta) {
            timelineMeta.textContent = `${sessions.length} บันทึกกิจกรรม`;
        }

    } catch (error) {
        console.error('Teacher dashboard render failed:', error);
        if (loading) loading.classList.add('hidden');
        if (summary) summary.innerHTML = '';
        if (tableBody) tableBody.innerHTML = '';
        if (timeline) timeline.innerHTML = '';
        if (tableMeta) tableMeta.textContent = '';
        if (timelineMeta) timelineMeta.textContent = '';
        if (rankingContainer) rankingContainer.innerHTML = '';
        if (rankingMeta) rankingMeta.textContent = '';
        if (emptyState) {
            emptyState.classList.remove('hidden');
            emptyState.innerHTML = `
                <div class="space-y-2">
                    <p class="font-semibold text-slate-700">ไม่สามารถโหลดข้อมูลครูได้ในขณะนี้</p>
                    <p class="text-sm text-slate-500">กรุณาลองรีเฟรชหรือตรวจสอบการเชื่อมต่ออีกครั้ง</p>
                </div>
            `;
        }
        resetTeacherStudentDetail();
        showNotification('ไม่สามารถโหลดแดชบอร์ดครูได้ กรุณาลองใหม่อีกครั้ง', 'error');
    }
}

function resetTeacherStudentDetail() {
    const container = document.getElementById('teacherStudentDetailContent');
    if (!container) return;
    container.classList.add('text-center');
    container.innerHTML = '<p class="text-sm text-slate-500">คลิกชื่อนักเรียนจากตารางเพื่อเปิดหน้าต่างรายงาน</p>';
    closeTeacherStudentModal();
}

function getTeacherStudentProfile(studentKey) {
    if (!studentKey) return null;
    const { students = [], rows = [] } = teacherDashboardState;
    const direct = Array.isArray(students) ? students.find(student => student.key === studentKey || student.studentId === studentKey) : null;
    if (direct) return { ...direct };
    const row = Array.isArray(rows) ? rows.find(entry => entry.key === studentKey || entry.studentId === studentKey) : null;
    if (row) return { ...row };
    return null;
}

function openTeacherEditStudent(studentKey) {
    const profile = getTeacherStudentProfile(studentKey);
    if (!profile) {
        showNotification('ไม่พบนักเรียนที่ต้องการแก้ไข', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'teacherEditStudentModal';
    modal.className = 'fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4';

    const modalCard = document.createElement('div');
    modalCard.className = 'modal-card scrollable bg-white rounded-3xl p-6 md:p-8 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative';
    modalCard.innerHTML = `
        <button type="button" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600" aria-label="ปิด">
            ✕
        </button>
        <div class="space-y-6">
            <div class="space-y-1">
                <h2 class="text-xl font-bold text-slate-900">✏️ แก้ไขข้อมูลนักเรียน</h2>
                <p class="text-sm text-slate-500">รหัสนักเรียน <span class="font-semibold">${profile.studentId || profile.key || '-'}</span></p>
            </div>
            <form id="teacherEditStudentForm" class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label class="space-y-2 text-sm font-medium text-slate-700">
                        <span>ชื่อ-นามสกุล</span>
                        <input type="text" name="name" value="${profile.name || ''}" class="modern-input p-3" required>
                    </label>
                    <label class="space-y-2 text-sm font-medium text-slate-700">
                        <span>ชั้น</span>
                        <input type="text" name="grade" value="${profile.grade || ''}" class="modern-input p-3" required>
                    </label>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label class="space-y-2 text-sm font-medium text-slate-700">
                        <span>ห้อง</span>
                        <input type="text" name="room" value="${profile.room || ''}" class="modern-input p-3" required>
                    </label>
                    <label class="space-y-2 text-sm font-medium text-slate-700">
                        <span>เลขที่</span>
                        <input type="text" name="number" value="${profile.number || ''}" class="modern-input p-3" required>
                    </label>
                </div>
                <label class="space-y-2 text-sm font-medium text-slate-700 block">
                    <span>เบอร์โทรศัพท์ (ใช้เข้าสู่ระบบ)</span>
                    <input type="tel" name="phone" value="${profile.phone || ''}" class="modern-input p-3" required>
                </label>
                <div class="flex flex-wrap gap-3 justify-end">
                    <button type="button" class="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200" data-role="cancel">ยกเลิก</button>
                    <button type="submit" class="px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700">บันทึก</button>
                </div>
            </form>
        </div>
    `;

    modal.appendChild(modalCard);
    const closeModal = () => {
        modal.remove();
        decrementModalCount();
    };

    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeModal();
        }
    });

    modalCard.querySelector('button[aria-label="ปิด"]').addEventListener('click', closeModal);
    modalCard.querySelector('button[data-role="cancel"]').addEventListener('click', closeModal);

    const form = modalCard.querySelector('#teacherEditStudentForm');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const formData = new FormData(form);
        const updates = {
            name: formData.get('name').trim(),
            grade: formData.get('grade').trim(),
            room: formData.get('room').trim(),
            number: formData.get('number').trim(),
            phone: formData.get('phone').trim()
        };

        const phoneValid = updates.phone && updates.phone.length >= 10;
        if (!updates.name || !updates.grade || !updates.room || !updates.number || !phoneValid) {
            showNotification('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', 'error');
            return;
        }

        const result = await saveTeacherStudentEdits(studentKey, updates);
        if (result.ok) {
            showNotification('อัปเดตข้อมูลนักเรียนเรียบร้อย', 'success');
            closeModal();
            await renderTeacherDashboard();
        } else {
            showNotification(result.error || 'ไม่สามารถอัปเดตข้อมูลได้', 'error');
        }
    });

    document.body.appendChild(modal);
    incrementModalCount();
}

async function saveTeacherStudentEdits(studentKey, updates) {
    try {
        const profile = getTeacherStudentProfile(studentKey);
        if (!profile) {
            return { ok: false, error: 'ไม่พบนักเรียนที่ต้องการแก้ไข' };
        }

        const studentId = profile.studentId || profile.key || studentKey;
        const merged = {
            ...profile,
            ...updates,
            studentId,
            key: profile.key || studentId,
            updatedAt: new Date().toISOString(),
            isStudent: true
        };

        if (db) {
            await db.collection('User').doc(studentId).set(merged, { merge: true });
        }

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`student_${studentId}`, JSON.stringify(merged));
        }

        teacherDashboardState.students = (teacherDashboardState.students || []).map(student => {
            if (student.key === profile.key || student.studentId === studentId) {
                return { ...student, ...merged };
            }
            return student;
        });

        teacherDashboardState.rows = (teacherDashboardState.rows || []).map(row => {
            if (row.key === profile.key || row.studentId === studentId) {
                return { ...row, name: merged.name, grade: merged.grade, room: merged.room, number: merged.number };
            }
            return row;
        });

        if (gameState.userId === studentId) {
            gameState.currentUser = { ...(gameState.currentUser || {}), ...merged };
            const gradeLabel = merged.grade || '-';
            const roomLabel = merged.room ? `/${merged.room}` : '';
            const numberLabel = merged.number || '-';
            const contactLabel = `${gradeLabel}${roomLabel} เลขที่ ${numberLabel}`;
            updateLoginUI({
                displayName: merged.name,
                email: contactLabel,
                photoURL: '',
                isStudent: true,
                studentData: merged
            });
            updateUserNameDisplay();
        }

        return { ok: true };
    } catch (error) {
        console.error('saveTeacherStudentEdits error', error);
        return { ok: false, error: 'เกิดข้อผิดพลาดในการบันทึกข้อมูล' };
    }
}

function requestTeacherDeleteStudent(studentKey) {
    const profile = getTeacherStudentProfile(studentKey);
    if (!profile) {
        showNotification('ไม่พบนักเรียนที่ต้องการลบ', 'error');
        return;
    }

    const confirmed = confirm(`ต้องการลบข้อมูลของ ${profile.name || 'นักเรียนนี้'} และบันทึกทั้งหมดหรือไม่?`);
    if (!confirmed) return;
    deleteTeacherStudent(studentKey).catch(error => {
        console.error('deleteTeacherStudent failed', error);
        showNotification('ไม่สามารถลบข้อมูลนักเรียนได้', 'error');
    });
}

async function deleteTeacherStudent(studentKey) {
    const profile = getTeacherStudentProfile(studentKey);
    if (!profile) throw new Error('ไม่พบนักเรียนในระบบ');

    const studentId = profile.studentId || profile.key || studentKey;

    if (db) {
        try {
            await db.collection('User').doc(studentId).delete();
        } catch (error) {
            console.warn('ไม่สามารถลบโปรไฟล์นักเรียนใน Firestore ได้', error);
        }

        const deleteSessions = async (collectionName) => {
            try {
                const snapshot = await db.collection(collectionName).where('userId', '==', studentId).get();
                const batch = db.batch();
                snapshot.forEach(doc => batch.delete(doc.ref));
                if (!snapshot.empty) {
                    await batch.commit();
                }
            } catch (error) {
                console.warn(`ไม่สามารถลบข้อมูลใน ${collectionName}`, error);
            }
        };

        await deleteSessions('GameSession');
        await deleteSessions('gameSessions');
    }

    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(`student_${studentId}`);
        const cacheValue = localStorage.getItem('GameSessionCache');
        if (cacheValue) {
            try {
                const parsed = JSON.parse(cacheValue);
                if (Array.isArray(parsed)) {
                    const filtered = parsed.filter(entry => entry && entry.userId !== studentId && entry.studentId !== studentId);
                    localStorage.setItem('GameSessionCache', JSON.stringify(filtered));
                }
            } catch (error) {
                console.error('ล้างแคช GameSessionCache ไม่สำเร็จ', error);
            }
        }
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('gameSession_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && (data.userId === studentId || data.studentId === studentId)) {
                        keysToRemove.push(key);
                    }
                } catch (error) {
                    console.error('ตรวจสอบแคชเกมไม่สำเร็จ', error);
                }
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    teacherDashboardState.students = (teacherDashboardState.students || []).filter(student => student.key !== profile.key && student.studentId !== studentId);
    teacherDashboardState.rows = (teacherDashboardState.rows || []).filter(row => row.key !== profile.key && row.studentId !== studentId);
    teacherDashboardState.sessions = (teacherDashboardState.sessions || []).filter(session => session.userId !== studentId && session.studentId !== studentId);

    if (gameState.userId === studentId) {
        gameState.gameId = null;
        gameState.userId = null;
        gameState.currentUser = null;
        await signOutUser();
    }

    showNotification('ลบข้อมูลนักเรียนเรียบร้อยแล้ว', 'success');
    await renderTeacherDashboard();
}

function showTeacherStudentDetail(studentKey) {
    const container = document.getElementById('teacherStudentDetailContent');
    if (!container || !studentKey) {
        resetTeacherStudentDetail();
        return;
    }

    const studentRow = teacherDashboardState.rows.find(row => row.key === studentKey || row.studentId === studentKey);
    if (!studentRow) {
        resetTeacherStudentDetail();
        return;
    }

    const sessions = [...(studentRow.sessions || [])].sort((a, b) => {
        const aDate = parseDate(a.lastUpdatedAt || a.timestampAt || a.lastUpdated || a.timestamp);
        const bDate = parseDate(b.lastUpdatedAt || b.timestampAt || b.lastUpdated || b.timestamp);
        return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    });

    const latestSession = sessions[0] || null;
    const latestScore = latestSession ? Math.round(Number(latestSession.totalScore) || Number(latestSession.comprehensionScore) || 0) : 0;
    const currentStep = latestSession ? latestSession.currentStep : null;
    const gradeRoom = studentRow.grade ? `${studentRow.grade}${studentRow.room ? `/${studentRow.room}` : ''}` : '-';
    const studentTotalScore = studentRow.totalScore ? Math.round(studentRow.totalScore) : 0;
    const averageScore = studentRow.averageScore ? Math.round(studentRow.averageScore) : (studentRow.sessions.length ? Math.round(studentTotalScore / studentRow.sessions.length) : 0);
    const lastActivity = latestSession ? formatDateTime(latestSession.lastUpdatedAt || latestSession.timestampAt || latestSession.lastUpdated || latestSession.timestamp) : '-';

    const today = new Date();
    const todaySessions = sessions.filter(session => {
        const sessionDate = parseDate(session.lastUpdatedAt || session.timestampAt || session.lastUpdated || session.timestamp);
        return sessionDate ? isSameDay(sessionDate, today) : false;
    });

    const todayScore = todaySessions.reduce((sum, session) => sum + (Number(session.totalScore) || Number(session.comprehensionScore) || 0), 0);
    const todayCompleted = todaySessions.filter(session => session.completed).length;

    const headerStats = [
        { label: 'คะแนนสะสม', value: studentTotalScore.toLocaleString('th-TH'), icon: '🎯' },
        { label: 'คะแนนเฉลี่ย', value: averageScore.toLocaleString('th-TH'), icon: '📊' },
        { label: 'คะแนนล่าสุด', value: latestScore.toLocaleString('th-TH'), icon: '📈' },
        { label: 'ภารกิจสำเร็จ', value: studentRow.completionCount || 0, icon: '🏆' },
        { label: 'ขั้นปัจจุบัน', value: getStepLabel(currentStep), icon: '🧭' }
    ];

    const recentActivities = sessions.slice(0, 5);

    const activityCards = recentActivities.length
        ? recentActivities.map((activity, index) => {
            const activityDate = formatDateTime(activity.lastUpdatedAt || activity.timestampAt || activity.lastUpdated || activity.timestamp);
            const activityScore = Math.round(Number(activity.totalScore) || Number(activity.comprehensionScore) || 0);
            const stepLabel = getStepLabel(activity.currentStep);
            const status = activity.completed ? 'เสร็จสิ้นภารกิจ' : `กำลังเรียนรู้: ${stepLabel}`;
            const activityKey = getSessionIdentifier(activity, `${studentRow.studentId || studentRow.key || 'session'}_${index}`);
            return `
                <button type="button" class="teacher-activity-card rounded-2xl border border-slate-200 bg-white/90 p-4 flex flex-col gap-2 shadow-sm text-left" data-session-key="${activityKey}">
                    <div class="flex items-start justify-between gap-3">
                        <div class="font-semibold text-slate-900 leading-tight">${activity.userName || studentRow.name}</div>
                        <span class="text-xs text-slate-500 whitespace-nowrap">${activityDate}</span>
                    </div>
                    <p class="text-sm text-slate-600">${status}</p>
                    <div class="text-sm font-semibold text-blue-700">คะแนน ${activityScore.toLocaleString('th-TH')} แต้ม</div>
                </button>
            `;
        }).join('')
        : '<p class="text-sm text-slate-500">ยังไม่มีบันทึกกิจกรรมของนักเรียนคนนี้</p>';

    const todaySummary = [
        { label: 'กิจกรรมที่บันทึกวันนี้', value: todaySessions.length || 0, icon: '🗓️' },
        { label: 'คะแนนที่ได้วันนี้', value: todayScore ? todayScore.toLocaleString('th-TH') : '0', icon: '⭐' },
        { label: 'ภารกิจสำเร็จวันนี้', value: todayCompleted || 0, icon: '✅' },
        { label: 'อัปเดตล่าสุด', value: lastActivity, icon: '⏱️' }
    ];

    const detailHtml = `
        <div class="space-y-6 text-left">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div>
                    <p class="text-xs uppercase tracking-wide text-slate-500">นักเรียน</p>
                    <h5 class="text-2xl font-bold text-slate-900">${studentRow.name || 'ไม่ระบุชื่อ'}</h5>
                    <p class="text-sm text-slate-500">${gradeRoom} • เลขที่ ${studentRow.number || '-'}</p>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    ${headerStats.map(stat => `
                        <div class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                            <div class="text-lg">${stat.icon}</div>
                            <p class="text-xs text-slate-500 mt-1">${stat.label}</p>
                            <p class="text-lg font-semibold text-slate-900">${stat.value}</p>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <h5 class="text-base font-semibold text-slate-900">กิจกรรมล่าสุด</h5>
                    <span class="text-xs text-slate-500">ทั้งหมด ${studentRow.sessions.length} กิจกรรม</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    ${activityCards}
                </div>
            </div>

            <div class="space-y-3">
                <h5 class="text-base font-semibold text-slate-900">ข้อมูลสำคัญ</h5>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    ${todaySummary.map(stat => `
                        <div class="rounded-2xl border border-slate-200 bg-white/90 p-4">
                            <div class="text-lg">${stat.icon}</div>
                            <p class="text-xs text-slate-500 mt-1">${stat.label}</p>
                            <p class="text-lg font-semibold text-slate-900">${stat.value}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;

    container.classList.remove('text-center');
    container.innerHTML = detailHtml;
    openTeacherStudentModal(detailHtml);
}

function closeTeacherStudentModal() {
    const existing = document.getElementById('teacherStudentModal');
    if (existing) {
        closeTeacherActivityModal();
        existing.remove();
        decrementModalCount();
    }
}

function openTeacherStudentModal(content) {
    closeTeacherStudentModal();

    const modal = document.createElement('div');
    modal.id = 'teacherStudentModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
        <div class="modal-card scrollable bg-white rounded-3xl p-6 md:p-8 shadow-2xl relative">
            <button type="button" class="absolute top-4 right-4 text-slate-500 hover:text-slate-700" aria-label="ปิดรายงาน" onclick="closeTeacherStudentModal()">✕</button>
            <div class="space-y-6">${content}</div>
        </div>
    `;

    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeTeacherStudentModal();
        }
    });

    document.body.appendChild(modal);
    incrementModalCount();
    attachTeacherActivityCardHandlers(modal);
}

function attachTeacherActivityCardHandlers(root) {
    const scope = root || document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return;

    const cards = scope.querySelectorAll('.teacher-activity-card, .teacher-activity-timeline-card');
    cards.forEach(card => {
        if (!card || card.dataset.boundActivity === 'true') return;
        const sessionKey = card.getAttribute('data-session-key');
        if (!sessionKey) return;
        card.dataset.boundActivity = 'true';
        card.addEventListener('click', () => {
            openTeacherActivityDetail(sessionKey);
        });
    });
}

function openTeacherActivityDetail(sessionKey) {
    if (!sessionKey) return;

    const sessions = Array.isArray(teacherDashboardState.sessions) ? teacherDashboardState.sessions : [];
    const session = sessions.find(item => {
        const identifier = getSessionIdentifier(item);
        return identifier === sessionKey || item.id === sessionKey || item.key === sessionKey;
    });

    if (!session) {
        showNotification('ไม่พบข้อมูลกิจกรรมที่เลือก', 'error');
        return;
    }

    const rows = Array.isArray(teacherDashboardState.rows) ? teacherDashboardState.rows : [];
    const students = Array.isArray(teacherDashboardState.students) ? teacherDashboardState.students : [];

    const studentRow = rows.find(row => row.studentId === session.userId || row.studentId === session.studentId || row.key === session.key);
    const studentProfile = studentRow
        || students.find(student => student.studentId === session.userId || student.studentId === session.studentId || student.key === session.key)
        || null;

    const studentName = session.userName || studentProfile?.name || 'นักเรียนไม่ระบุชื่อ';
    const studentId = session.studentId || session.userId || studentProfile?.studentId || '-';
    const gradeRoom = studentProfile?.grade
        ? `${studentProfile.grade}${studentProfile.room ? `/${studentProfile.room}` : ''}`
        : session.grade
            ? `${session.grade}${session.room ? `/${session.room}` : ''}`
            : '-';

    const lastUpdated = formatDateTime(session.lastUpdatedAt || session.timestampAt || session.lastUpdated || session.timestamp);
    const totalScoreRaw = Number(session.totalScore ?? session.comprehensionScore ?? 0);
    const totalScore = Math.max(0, Math.round(totalScoreRaw));
    const comprehensionScore = Math.max(0, Math.round(Number(session.comprehensionScore ?? 0)));
    const matchingScore = Math.max(0, Math.round(Number(session.matchingScore ?? 0)));
    const vocabScore = Math.max(0, Math.round(Number(session.vocabScore ?? calculateVocabularyScore(session.translatedWords))));
    const matchedPairs = Number(session.matchedPairs ?? (Object.keys(session.translatedWords || {}).length || 0));
    const statusLabel = session.completed ? 'เสร็จสิ้นภารกิจ' : `กำลังเรียนรู้ (${getStepLabel(session.currentStep)})`;

    const translatedEntries = Object.entries(session.translatedWords || {});
    const incorrectEntries = Object.keys(session.incorrectWords || {});
    const comprehensionAnswers = Array.isArray(session.comprehensionAnswers) ? session.comprehensionAnswers : [];

    const translatedHtml = translatedEntries.length
        ? `<ul class="space-y-2">
                ${translatedEntries.map(([word, detail]) => {
                    const meaning = detail?.meaning || detail?.definition || '-';
                    const reference = detail?.reference || detail?.source || '';
                    const points = Number(detail?.points || detail?.score || 0);
                    return `
                        <li class="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                            <p class="font-semibold text-blue-900">${word}</p>
                            <p class="text-sm text-slate-600 mt-1">${meaning}</p>
                            ${reference ? `<p class="text-xs text-blue-600 mt-1">แหล่งอ้างอิง: ${reference}</p>` : ''}
                            <p class="text-xs text-blue-500 mt-1">+${points} แต้ม</p>
                        </li>
                    `;
                }).join('')}
            </ul>`
        : '<p class="text-sm text-slate-500">ยังไม่มีข้อมูลการสืบค้นคำศัพท์</p>';

    const incorrectHtml = incorrectEntries.length
        ? `<div class="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
                คำที่ยังตอบไม่ถูก: ${incorrectEntries.map(word => `<span class="font-semibold">${word}</span>`).join(', ')}
           </div>`
        : '';

    const answersHtml = comprehensionAnswers.length
        ? `<ul class="space-y-2 text-sm text-slate-700">
                ${comprehensionAnswers.map(answer => {
                    if (!answer) return '';
                    const question = answer.question || answer.prompt || '';
                    const response = answer.answer || answer.response || '';
                    const points = Number(answer.points || answer.score || 0);
                    return `
                        <li class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                            ${question ? `<p class="text-xs text-emerald-600 uppercase tracking-wide">${question}</p>` : ''}
                            <p class="mt-1">${response || '—'}</p>
                            <p class="text-xs text-emerald-600 mt-2">+${points} แต้ม</p>
                        </li>
                    `;
                }).join('')}
            </ul>`
        : '<p class="text-sm text-slate-500">ไม่มีคำตอบการจับใจความที่บันทึกไว้</p>';

    const interpretation = session.interpretationText ? `<div class="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 text-sm text-slate-700 leading-relaxed">
            <p class="text-xs uppercase tracking-wide text-indigo-500">ถอดความ</p>
            <p class="mt-2">${session.interpretationText}</p>
        </div>` : '';

    const imagination = session.imaginationText ? `<div class="rounded-2xl border border-purple-200 bg-purple-50/70 p-4 text-sm text-slate-700 leading-relaxed">
            <p class="text-xs uppercase tracking-wide text-purple-500">จินตนาการ</p>
            <p class="mt-2">${session.imaginationText}</p>
        </div>` : '';

    closeTeacherActivityModal();

    const modal = document.createElement('div');
    modal.id = 'teacherActivityModal';
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center p-4';
    modal.style.zIndex = '60';
    modal.innerHTML = `
        <div class="modal-card scrollable bg-white rounded-3xl p-6 md:p-8 shadow-2xl relative max-w-3xl w-full">
            <button type="button" class="absolute top-4 right-4 text-slate-500 hover:text-slate-700" aria-label="ปิดรายละเอียดกิจกรรม" onclick="closeTeacherActivityModal()">✕</button>
            <div class="space-y-6">
                <div class="space-y-1">
                    <h3 class="text-xl font-bold text-slate-900">รายละเอียดกิจกรรมของ ${studentName}</h3>
                    <p class="text-sm text-slate-500">รหัสนักเรียน ${studentId} • ชั้น ${gradeRoom}</p>
                    <p class="text-xs text-slate-500">อัปเดตล่าสุด ${lastUpdated}</p>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">🏅</div>
                        <p class="text-xs text-slate-500">คะแนนรวม</p>
                        <p class="text-lg font-semibold text-slate-900">${totalScore.toLocaleString('th-TH')} แต้ม</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">📍</div>
                        <p class="text-xs text-slate-500">สถานะกิจกรรม</p>
                        <p class="text-lg font-semibold text-slate-900">${statusLabel}</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">🔍</div>
                        <p class="text-xs text-slate-500">สืบค้นคำศัพท์</p>
                        <p class="text-lg font-semibold text-slate-900">${translatedEntries.length} คำ (+${vocabScore} แต้ม)</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">🧩</div>
                        <p class="text-xs text-slate-500">จับคู่คำศัพท์</p>
                        <p class="text-lg font-semibold text-slate-900">${matchedPairs} คู่ (+${matchingScore} แต้ม)</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">📖</div>
                        <p class="text-xs text-slate-500">จับใจความ</p>
                        <p class="text-lg font-semibold text-slate-900">${comprehensionScore} แต้ม</p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <div class="text-lg">🕒</div>
                        <p class="text-xs text-slate-500">เวลาบันทึก</p>
                        <p class="text-lg font-semibold text-slate-900">${lastUpdated}</p>
                    </div>
                </div>
                <div class="space-y-3">
                    <h4 class="text-base font-semibold text-slate-900">การสืบค้นคำศัพท์</h4>
                    ${translatedHtml}
                    ${incorrectHtml}
                </div>
                <div class="space-y-3">
                    <h4 class="text-base font-semibold text-slate-900">การจับใจความ</h4>
                    ${answersHtml}
                </div>
                ${interpretation || imagination ? `<div class="space-y-3">
                    <h4 class="text-base font-semibold text-slate-900">ผลงานการถอดความและจินตนาการ</h4>
                    ${interpretation || ''}
                    ${imagination || ''}
                </div>` : ''}
            </div>
        </div>
    `;

    modal.addEventListener('click', event => {
        if (event.target === modal) {
            closeTeacherActivityModal();
        }
    });

    document.body.appendChild(modal);
    incrementModalCount();
}

function closeTeacherActivityModal() {
    const modal = document.getElementById('teacherActivityModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
        const numberDate = new Date(value);
        return isNaN(numberDate.getTime()) ? null : numberDate;
    }
    if (typeof value === 'string') {
        const stringDate = new Date(value);
        return isNaN(stringDate.getTime()) ? null : stringDate;
    }
    if (value && typeof value.toDate === 'function') {
        const viaToDate = value.toDate();
        return viaToDate instanceof Date && !isNaN(viaToDate.getTime()) ? viaToDate : null;
    }
    if (value && typeof value === 'object' && typeof value.seconds === 'number') {
        const ms = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
        const timestampDate = new Date(ms);
        return isNaN(timestampDate.getTime()) ? null : timestampDate;
    }
    return null;
}

function normalizeFirestoreValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value.map(item => normalizeFirestoreValue(item));
    }
    if (typeof value === 'object') {
        const asDate = parseDate(value);
        if (asDate) {
            return asDate.toISOString();
        }
        const normalized = {};
        Object.entries(value).forEach(([key, val]) => {
            normalized[key] = normalizeFirestoreValue(val);
        });
        return normalized;
    }
    return value;
}

function normalizeStudentRecord(rawStudent = {}) {
    const student = normalizeFirestoreValue(rawStudent) || {};
    const key = student.studentId || student.id || student.uid || student.userId || student.email || student.name || '';
    return {
        ...student,
        key,
        studentId: student.studentId || student.id || student.uid || student.userId || key,
        name: student.name || student.displayName || 'นักเรียนไม่ระบุชื่อ',
        grade: student.grade || student.gradeLevel || student.classLevel || student.level || '-',
        room: student.room || student.classroom || student.class || student.section || '-',
        number: student.number || student.studentNumber || student.no || student.index || '-',
    };
}

function calculateVocabularyScore(translatedWords = {}) {
    return Object.values(translatedWords).reduce((sum, entry) => {
        if (!entry || typeof entry !== 'object') return sum;
        return sum + (Number(entry.points) || 0);
    }, 0);
}

function getSessionIdentifier(session, fallback = '') {
    if (!session) return fallback;
    const candidateKeys = ['sessionKey', 'id', 'gameId', 'docId', 'recordId', 'sessionId', '_id', 'uid'];
    for (const key of candidateKeys) {
        if (session[key]) {
            return session[key];
        }
    }
    if (session.key && session.key !== session.studentId) {
        return session.key;
    }
    if ((session.userId || session.studentId) && (session.timestamp || session.lastUpdated)) {
        const timeValue = session.timestamp || session.lastUpdated;
        return `${session.userId || session.studentId}_${timeValue}`;
    }
    return fallback;
}

function normalizeSessionRecord(rawSession = {}, keyOverride) {
    try {
        const session = normalizeFirestoreValue(rawSession) || {};
        const key = keyOverride
            || session.studentId
            || session.userId
            || session.userEmail
            || session.userName
            || session.id
            || '';

        const lastUpdatedAt = parseDate(session.lastUpdated || session.updatedAt || session.finishedAt || session.completedAt);
        const timestampAt = parseDate(session.timestamp || session.createdAt || session.startedAt || lastUpdatedAt);
        const sessionKeyCandidate = getSessionIdentifier(session);
        const sessionKey = sessionKeyCandidate || (() => {
            const base = session.userId || session.studentId || key || 'session';
            const seed = timestampAt ? timestampAt.getTime() : Date.now();
            return `${base}_${seed}`;
        })();

        const vocabScore = calculateVocabularyScore(session.translatedWords);
        const comprehensionScore = Number(session.comprehensionScore ?? 0);
        const matchingScore = Number(session.matchingScore ?? 0);
        const currentStep = Number(session.currentStep ?? session.step ?? 1);
        const totalScore = typeof session.totalScore === 'number'
            ? Number(session.totalScore) || 0
            : vocabScore + comprehensionScore + matchingScore;

        return {
            ...session,
            key,
            sessionKey,
            studentId: session.studentId || session.userId || key,
            userId: session.userId || session.studentId || key,
            userName: session.userName || session.displayName || session.studentName || 'นักเรียนไม่ระบุชื่อ',
            userEmail: session.userEmail || session.email || '',
            grade: session.grade || session.gradeLevel || session.classLevel || '-',
            room: session.room || session.classroom || session.class || '-',
            number: session.number || session.studentNumber || session.no || '-',
            currentStep,
            totalScore,
            comprehensionScore,
            matchingScore,
            vocabScore,
            completed: Boolean(session.completed || currentStep === 6),
            lastUpdatedAt,
            timestampAt,
        };
    } catch (err) {
        console.error('Error normalizeSessionRecord:', err);
        return { key: keyOverride, userName: 'Unknown', error: String(err?.message || err) };
    }
}

function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return '-';
    try {
        return date.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
    } catch (error) {
        return date.toLocaleString();
    }
}

function isSameDay(dateA, dateB) {
    if (!dateA || !dateB) return false;
    return dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate();
}

function buildStudentRows(students = [], sessions = []) {
    const studentMap = new Map();
    students.forEach(student => {
        if (!student || !student.key) return;
        studentMap.set(student.key, student);
    });

    const rows = new Map();

    sessions.forEach(session => {
        if (!session || !session.key) return;
        if (!rows.has(session.key)) {
            const baseStudent = studentMap.get(session.key);
            rows.set(session.key, {
                key: session.key,
                name: session.userName || baseStudent?.name || 'นักเรียนไม่ระบุชื่อ',
                grade: session.grade || baseStudent?.grade || '-',
                room: session.room || baseStudent?.room || '-',
                number: session.number || baseStudent?.number || '-',
                studentId: session.studentId || baseStudent?.studentId || session.key,
                totalScore: 0,
                averageScore: 0,
                latestSession: null,
                completionCount: 0,
                sessions: [],
            });
        }
        const entry = rows.get(session.key);
        entry.sessions.push(session);
        entry.totalScore += Number(session.totalScore) || 0;
        if (session.completed) {
            entry.completionCount += 1;
        }
        if (!entry.latestSession) {
            entry.latestSession = session;
        } else {
            const existingDate = entry.latestSession.lastUpdatedAt || entry.latestSession.timestampAt;
            const incomingDate = session.lastUpdatedAt || session.timestampAt;
            if (incomingDate && (!existingDate || incomingDate > existingDate)) {
                entry.latestSession = session;
            }
        }
    });

    rows.forEach(entry => {
        if (entry.sessions.length > 0) {
            entry.averageScore = Math.round(entry.totalScore / entry.sessions.length);
        }
        entry.rankTier = determineRankTier(entry.totalScore || 0);
    });

    students.forEach(student => {
        if (!student || !student.key) return;
        if (!rows.has(student.key)) {
            rows.set(student.key, {
                key: student.key,
                name: student.name || 'นักเรียนไม่ระบุชื่อ',
                grade: student.grade || '-',
                room: student.room || '-',
                number: student.number || '-',
                studentId: student.studentId || student.key,
                totalScore: 0,
                averageScore: 0,
                latestSession: null,
                completionCount: 0,
                sessions: [],
            });
        } else {
            const entry = rows.get(student.key);
            entry.name = student.name || entry.name;
            entry.grade = student.grade || entry.grade;
            entry.room = student.room || entry.room;
            entry.number = student.number || entry.number;
            entry.studentId = student.studentId || entry.studentId;
        }
    });

    return Array.from(rows.values());
}

async function fetchTeacherData() {
    let students = [];
    let sessions = [];

    try {
        if (db) {
            const [studentSnapshot, legacySessions, canonicalSessions] = await Promise.all([
                db.collection('User').where('isStudent', '==', true).get().catch(() => null),
                db.collection('gameSessions').get().catch(() => null),
                db.collection('GameSession').get().catch(() => null)
            ]);

            if (studentSnapshot) {
                studentSnapshot.forEach(doc => {
                    students.push({ id: doc.id, ...doc.data() });
                });
            }

            const sessionMap = new Map();
            const addSessionDoc = (doc) => {
                if (!doc) return;
                const data = { id: doc.id, ...doc.data() };
                const key = data.id || data.gameId || data.userId || doc.id;
                if (!sessionMap.has(key)) {
                    sessionMap.set(key, data);
                }
            };

            if (legacySessions) {
                legacySessions.forEach(addSessionDoc);
            }

            if (canonicalSessions) {
                canonicalSessions.forEach(addSessionDoc);
            }

            if (sessionMap.size > 0) {
                sessions = Array.from(sessionMap.values());
            }
        }
    } catch (error) {
        console.error('Error loading data from Firebase for teacher portal:', error);
    }

    if (sessions.length === 0 || students.length === 0) {
        try {
            const response = await fetch('/gameSessions');
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    if (sessions.length === 0) sessions = data;
                } else {
                    if (Array.isArray(data.sessions) && sessions.length === 0) {
                        sessions = data.sessions;
                    }
                    if (Array.isArray(data.students) && students.length === 0) {
                        students = data.students;
                    }
                }
            }
        } catch (error) {
            console.warn('Fetch to /gameSessions failed:', error);
        }
    }

    if (students.length === 0) {
        const localStudents = loadLocalStudents();
        if (localStudents.length) {
            students = localStudents;
        }
    }

    if (sessions.length === 0) {
        const localSessions = loadLocalSessions();
        if (localSessions.length) {
            sessions = localSessions;
        }
    }

    if (students.length === 0 && sessions.length > 0) {
        const synthesizedStudents = new Map();
        sessions.forEach(session => {
            const normalizedSession = normalizeSessionRecord(session);
            const key = normalizedSession.key;
            if (!key || synthesizedStudents.has(key)) return;
            synthesizedStudents.set(key, {
                studentId: normalizedSession.studentId || key,
                name: normalizedSession.userName || 'นักเรียนไม่ระบุชื่อ',
                grade: normalizedSession.grade || '-',
                room: normalizedSession.room || '-',
                number: normalizedSession.number || '-',
            });
        });
        students = Array.from(synthesizedStudents.values());
    }

    let normalizedStudents = students
        .map(student => normalizeStudentRecord(student))
        .filter(student => student && student.key);

    let normalizedSessions = sessions
        .map(session => normalizeSessionRecord(session))
        .filter(session => session && session.key);

    if (normalizedStudents.length === 0 && normalizedSessions.length) {
        const synthesized = buildStudentRows([], normalizedSessions).map(row => ({
            studentId: row.studentId,
            name: row.name,
            grade: row.grade,
            room: row.room,
            number: row.number
        }));
        normalizedStudents = synthesized
            .map(student => normalizeStudentRecord(student))
            .filter(student => student && student.key);
    }

    return { students: normalizedStudents, sessions: normalizedSessions };
}

async function fetchStudentSessionsByUser(userId) {
    if (!userId) return [];
    const sessionMap = new Map();

    if (db) {
        try {
            const [canonical, legacy] = await Promise.all([
                db.collection('GameSession').where('userId', '==', userId).get().catch(() => null),
                db.collection('gameSessions').where('userId', '==', userId).get().catch(() => null)
            ]);

            const addSnapshot = snapshot => {
                if (!snapshot) return;
                snapshot.forEach(doc => {
                    const data = { id: doc.id, ...doc.data() };
                    const key = data.id || `${userId}_${doc.id}`;
                    sessionMap.set(key, data);
                });
            };

            addSnapshot(canonical);
            addSnapshot(legacy);
        } catch (error) {
            console.warn('Unable to query Firestore for student sessions', error);
        }
    }

    const localSessions = loadLocalSessions();
    localSessions
        .filter(entry => (entry.userId || entry.studentId) === userId)
        .forEach(entry => {
            const key = entry.id || entry.gameId || `${userId}_${entry.timestamp}`;
            sessionMap.set(key, entry);
        });

    const normalized = Array.from(sessionMap.values())
        .map(session => normalizeSessionRecord(session))
        .filter(session => session && (session.userId === userId || session.studentId === userId));

    return normalized.sort((a, b) => {
        const aDate = parseDate(a.lastUpdatedAt || a.timestampAt || a.lastUpdated || a.timestamp);
        const bDate = parseDate(b.lastUpdatedAt || b.timestampAt || b.lastUpdated || b.timestamp);
        return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    });
}

function loadLocalStudents() {
    const result = [];
    if (typeof localStorage === 'undefined') return result;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('student_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (data) result.push(data);
            } catch (error) {
                console.error('Failed to parse local student data', error);
            }
        }
    }
    return result;
}

function loadLocalSessions() {
    const result = new Map();
    if (typeof localStorage === 'undefined') return [];

    const cacheValue = localStorage.getItem('GameSessionCache');
    if (cacheValue) {
        try {
            const parsed = JSON.parse(cacheValue);
            if (Array.isArray(parsed)) {
                parsed.forEach(entry => {
                    if (!entry) return;
                    const key = entry.id || entry.gameId || entry.userId || entry.userEmail || entry.userName;
                    if (!key) return;
                    result.set(key, { ...entry });
                });
            }
        } catch (error) {
            console.error('Failed to parse GameSessionCache data', error);
        }
    }

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('gameSession_')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (!data) continue;
                const mapKey = data.id || data.gameId || data.userId || data.userEmail || data.userName || key;
                result.set(mapKey, data);
            } catch (error) {
                console.error('Failed to parse local session data', error);
            }
        }
    }
    return Array.from(result.values());
}

// Check for existing student login on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        populateDemoTeacherHints();
        // Try to restore previous student session
        const lastStudentId = localStorage.getItem('lastStudentId');
        if (lastStudentId) {
            try {
                // Try to load from database first
                let userData = await loadUserData(lastStudentId);

                if (userData) {
                    gameState.userId = lastStudentId;
                    gameState.currentUser = userData;

                    // Update player profile
                    playerProfile.exp = userData.exp || 0;
                    playerProfile.rank = userData.rank || 'มือใหม่';
                    playerProfile.level = userData.level || 1;
                    playerProfile.totalGamesPlayed = userData.totalGamesPlayed || 0;
                    playerProfile.bestScore = userData.bestScore || 0;

                    // Update UI
                    if (userData.isGoogle) {
                        updateLoginUI({
                            displayName: userData.name,
                            email: userData.email,
                            photoURL: userData.photoURL,
                            isGoogle: true,
                            userData: userData
                        });
                    } else {
                        updateLoginUI({
                            displayName: userData.name,
                            email: `${userData.grade}/${userData.room} เลขที่ ${userData.number}`,
                            photoURL: '',
                            isStudent: true,
                            studentData: userData
                        });
                    }

                    console.log('User session restored successfully');
                }
            } catch (error) {
                console.log('Error restoring user session:', error);
                localStorage.removeItem('lastStudentId');
            }
        }

        refreshHeaderCompactState();
        initializeStepChipEvents();
        initializeFloatingActions();
    } catch (error) {
        console.error('Initialisation failed', error);
        showNotification('ไม่สามารถเริ่มต้นระบบได้', 'error');
    }
});

// Navigation Functions
async function goBack() {
    try {
        // Save current state before going back
        await saveCurrentGameState();
        await saveAllUserAnswers();

        if (gameState.stepHistory.length > 0) {
            const previousStep = gameState.stepHistory.pop();
            await loadStepData(previousStep);
            await renderStep(previousStep);
        } else if (gameState.currentStep > 1) {
            const newStep = gameState.currentStep - 1;
            await loadStepData(newStep);
            await renderStep(newStep);
        }

        showNotification('ย้อนกลับเรียบร้อย', 'success');
    } catch (error) {
        console.error('Error going back:', error);
        showNotification('เกิดข้อผิดพลาดในการย้อนกลับ', 'error');
    }
}

async function goToHome() {
    if (confirm('คุณต้องการกลับไปหน้าหลักหรือไม่? ความคืบหน้าจะถูกบันทึกไว้')) {
        try {
            // Save current game state with all user data
            await saveCurrentGameState();
            await saveAllUserAnswers();

            // Hide game UI and show landing page
            showLandingPage();

            showNotification('กลับสู่หน้าหลักเรียบร้อย ความคืบหน้าถูกบันทึกไว้แล้ว', 'success');
        } catch (error) {
            console.error('Error going to home:', error);
            showNotification('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
        }
    }
}

async function resetGame() {
    if (confirm('คุณต้องการเริ่มเกมใหม่หรือไม่? ความคืบหน้าปัจจุบันจะหายไป')) {
        try {
            // Clear saved game data first
            if (gameState.gameId) {
                await clearGameSession(gameState.gameId);
            }

            // Reset game state completely
            gameState.currentStep = 1;
            gameState.maxStepReached = 1;
            gameState.translatedWords = {};
            gameState.incorrectWords = {};
            gameState.wordAttempts = {};
            gameState.imaginationText = '';
            gameState.interpretationText = '';
            gameState.comprehensionScore = 0;
            gameState.startTime = Date.now();
            gameState.selectedWord = null;
            gameState.stepHistory = [];
            gameState.comprehensionAnswers = [];
            gameState.gameId = generateGameId();

            // Hide game UI and show landing page
            showLandingPage();

            showNotification('เกมถูกรีเซ็ตแล้ว พร้อมเริ่มเกมใหม่!', 'success');
        } catch (error) {
            console.error('Error resetting game:', error);
            showNotification('เกิดข้อผิดพลาดในการรีเซ็ตเกม', 'error');
        }
    }
}

function showLandingPage() {
    const landingPage = document.getElementById('landingPage');
    const header = document.getElementById('header');
    const mainContent = document.getElementById('mainContent');
    const footer = document.getElementById('siteFooter');
    const stepBar = document.getElementById('stepUtilityBar');
    const playerBar = document.getElementById('playerStatusBar');
    const floatingActions = document.getElementById('floatingActionButtons');

    if (landingPage) landingPage.classList.remove('hidden');
    if (header) {
        header.classList.add('hidden');
        header.classList.remove('header-compact');
    }
    if (mainContent) mainContent.classList.add('hidden');
    if (stepBar) stepBar.classList.add('hidden');
    if (playerBar) playerBar.classList.add('hidden');
    if (floatingActions) {
        floatingActions.classList.add('hidden');
        floatingActions.classList.remove('show');
        floatingActions.setAttribute('aria-hidden', 'true');
    }
    if (footer) {
        if (gameState.userId) {
            footer.classList.remove('hidden');
        } else {
            footer.classList.add('hidden');
        }
    }

    // Update background transparency based on login status
    if (landingPage) {
        if (gameState.userId) {
            landingPage.classList.add('user-logged-in');
        } else {
            landingPage.classList.remove('user-logged-in');
        }
    }

    // Make sure start button is enabled if user is logged in
    const startGameBtn = document.getElementById('startGameBtn');
    const startWrapper = document.getElementById('startButtonWrapper');
    const startHint = document.getElementById('startButtonHint');
    if (startGameBtn && gameState.userId) {
        startGameBtn.disabled = false;
        if (startWrapper) startWrapper.classList.remove('hidden');
        if (startHint) {
            startHint.textContent = 'พร้อมเริ่มภารกิจได้เลย';
            startHint.classList.remove('text-slate-600/80');
            startHint.classList.add('text-emerald-700/80');
        }
    } else if (startGameBtn) {
        startGameBtn.disabled = true;
        if (startWrapper) startWrapper.classList.remove('hidden');
        if (startHint) {
            startHint.textContent = 'เข้าสู่ระบบก่อนเพื่อเปิดภารกิจ';
            startHint.classList.remove('text-emerald-700/80');
            startHint.classList.add('text-slate-600/80');
        }
    }
}

function generateGameId() {
    return `game_${gameState.userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function saveCurrentGameState() {
    const currentGameData = {
        currentStep: gameState.currentStep,
        translatedWords: gameState.translatedWords,
        incorrectWords: gameState.incorrectWords,
        wordAttempts: gameState.wordAttempts,
        imaginationText: gameState.imaginationText,
        interpretationText: gameState.interpretationText,
        comprehensionScore: gameState.comprehensionScore,
        startTime: gameState.startTime,
        stepHistory: gameState.stepHistory,
        comprehensionAnswers: gameState.comprehensionAnswers || [],
        matchingScore: gameState.matchingScore || 0,
        matchedPairs: gameState.matchedPairs || 0
    };

    await saveGameSession(currentGameData);
}

async function loadStepData(step) {
    try {
        if (gameState.gameId) {
            const savedData = await loadGameSession(gameState.gameId);
            if (savedData) {
                // Restore data without changing current step
                gameState.translatedWords = savedData.translatedWords || {};
                gameState.incorrectWords = savedData.incorrectWords || {};
                gameState.wordAttempts = savedData.wordAttempts || {};
                gameState.imaginationText = savedData.imaginationText || '';
                gameState.interpretationText = savedData.interpretationText || '';
                gameState.comprehensionScore = savedData.comprehensionScore || 0;
                gameState.comprehensionAnswers = savedData.comprehensionAnswers || [];
                gameState.startTime = savedData.startTime || Date.now();
                gameState.matchingScore = savedData.matchingScore || 0;
                gameState.matchedPairs = savedData.matchedPairs || 0;

                // Update UI to reflect loaded data
                setTimeout(() => {
                    updateWordStatesFromData();
                    updateWordCounts();

                    // Update matching game UI if on matching step
                    if (step === 2.5 && gameState.matchingScore !== undefined) {
                        const scoreElement = document.getElementById('matchingScore');
                        if (scoreElement) {
                            scoreElement.textContent = gameState.matchingScore;
                        }
                    }
                }, 100);
            }
        }
    } catch (error) {
        console.error('Error loading step data:', error);
    }
}

// Update word states from loaded data
function updateWordStatesFromData() {
    // Update correct words
    Object.keys(gameState.translatedWords).forEach(word => {
        const wordElement = document.querySelector(`[data-word="${word}"]`);
        if (wordElement) {
            wordElement.className = 'word-correct';
        }
    });

    // Update incorrect words and show hint images if needed
    Object.keys(gameState.incorrectWords).forEach(word => {
        const wordElement = document.querySelector(`[data-word="${word}"]`);
        if (wordElement) {
            wordElement.className = 'word-incorrect';

            // Show hint image if attempted 2+ times
            const attempts = gameState.wordAttempts[word] || 0;
            if (attempts >= 2 && !wordElement.parentElement.querySelector('.hint-image')) {
                const hintImageContainer = document.createElement('div');
                hintImageContainer.className = 'absolute z-10 hint-image';
                hintImageContainer.style.cssText = `
                    top: -80px;
                    left: 50%;
                    transform: translateX(-50%);
                    pointer-events: none;
                `;
                hintImageContainer.innerHTML = `
                    <div class="relative">
                        <img src="${getWordImage(word)}" alt="ใบ้สำหรับ ${word}" 
                             class="w-16 h-16 md:w-20 md:h-20 rounded-xl border-4 border-yellow-400 object-cover shadow-2xl animate-pulse bg-white p-1">
                        <div class="absolute -top-2 -right-2 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center text-xs font-bold text-yellow-900">💡</div>
                    </div>
                `;
                wordElement.parentElement.style.position = 'relative';
                wordElement.parentElement.appendChild(hintImageContainer);
            }
        }
    });
}

async function clearGameSession(gameId) {
    if (!gameId) {
        return;
    }

    const removeLocalCopies = () => {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(`gameSession_${gameId}`);
        const cacheValue = localStorage.getItem('GameSessionCache');
        if (!cacheValue) return;
        try {
            const parsed = JSON.parse(cacheValue);
            if (!Array.isArray(parsed)) return;
            const filtered = parsed.filter(entry => entry && entry.id !== gameId);
            localStorage.setItem('GameSessionCache', JSON.stringify(filtered));
        } catch (error) {
            console.error('Failed to prune GameSessionCache during clear', error);
        }
    };

    try {
        if (db) {
            await Promise.all([
                db.collection('gameSessions').doc(gameId).delete().catch(err => {
                    console.warn('Legacy gameSessions delete failed', err);
                }),
                db.collection('GameSession').doc(gameId).delete().catch(err => {
                    console.warn('GameSession delete failed', err);
                })
            ]);
        }
    } catch (error) {
        console.error('Error clearing game session from Firestore:', error);
    } finally {
        removeLocalCopies();
    }
}

// Start Game Function
async function startGame() {
    // Check if user is logged in
    if (!gameState.userId || !gameState.currentUser) {
        showNotification('กรุณาลงทะเบียนหรือเข้าสู่ระบบก่อนเริ่มเกม', 'error');
        return;
    }

    // Try to load the most recent game session for this user
    try {
        // Look for existing game sessions
        let savedGame = null;

        if (db) {
            const loadLatestSession = async (collectionName) => {
                try {
                    const querySnapshot = await db.collection(collectionName)
                        .where('userId', '==', gameState.userId)
                        .orderBy('lastUpdated', 'desc')
                        .limit(1)
                        .get();

                    if (!querySnapshot.empty) {
                        const gameDoc = querySnapshot.docs[0];
                        return { id: gameDoc.id, data: gameDoc.data() };
                    }
                } catch (error) {
                    console.warn(`Failed to load latest session from ${collectionName}`, error);
                }
                return null;
            };

            let latestSession = await loadLatestSession('gameSessions');
            if (!latestSession) {
                latestSession = await loadLatestSession('GameSession');
            }

            if (latestSession) {
                savedGame = latestSession.data;
                gameState.gameId = latestSession.id;
                console.log('Found saved game in Firebase:', latestSession.id);
            }
        }

        if (!savedGame && typeof localStorage !== 'undefined') {
            // Fallback: check localStorage for saved games
            const cacheValue = localStorage.getItem('GameSessionCache');
            if (cacheValue) {
                try {
                    const parsed = JSON.parse(cacheValue);
                    if (Array.isArray(parsed)) {
                        const sorted = parsed
                            .filter(entry => entry && entry.userId === gameState.userId)
                            .sort((a, b) => new Date(a.lastUpdated || a.timestamp || 0) - new Date(b.lastUpdated || b.timestamp || 0));
                        const latest = sorted.pop();
                        if (latest) {
                            savedGame = latest;
                            gameState.gameId = latest.id || latest.gameId || generateGameId();
                            console.log('Found saved game in GameSessionCache:', gameState.gameId);
                        }
                    }
                } catch (cacheError) {
                    console.error('Failed to read GameSessionCache for saved game', cacheError);
                }
            }

            if (!savedGame) {
                const keys = Object.keys(localStorage);
                const gameKeys = keys.filter(key => key.startsWith('gameSession_') && key.includes(gameState.userId));

                if (gameKeys.length > 0) {
                    const mostRecentKey = gameKeys.sort().pop();
                    savedGame = JSON.parse(localStorage.getItem(mostRecentKey));
                    gameState.gameId = mostRecentKey.replace('gameSession_', '');
                    console.log('Found saved game in localStorage:', mostRecentKey);
                }
            }
        }

        if (savedGame && savedGame.currentStep > 1) {
            // Restore saved game state
            gameState.currentStep = savedGame.currentStep;
            gameState.maxStepReached = Math.max(1, Math.floor(savedGame.currentStep === 2.5 ? 2 : savedGame.currentStep));
            gameState.translatedWords = savedGame.translatedWords || {};
            gameState.incorrectWords = savedGame.incorrectWords || {};
            gameState.wordAttempts = savedGame.wordAttempts || {};
            gameState.imaginationText = savedGame.imaginationText || '';
            gameState.interpretationText = savedGame.interpretationText || '';
            gameState.comprehensionScore = savedGame.comprehensionScore || 0;
            gameState.comprehensionAnswers = savedGame.comprehensionAnswers || [];
            gameState.startTime = savedGame.startTime || Date.now();
            gameState.stepHistory = savedGame.stepHistory || [];
            gameState.matchingScore = savedGame.matchingScore || 0;
            gameState.matchedPairs = savedGame.matchedPairs || 0;

            showNotification(`โหลดเกมที่บันทึกไว้เรียบร้อย! (ขั้นตอนที่ ${savedGame.currentStep})`, 'success');
        } else {
            // Start fresh game
            gameState.gameId = generateGameId();
            gameState.currentStep = 1;
            gameState.maxStepReached = 1;
            gameState.startTime = Date.now();
            showNotification('เริ่มเกมใหม่!', 'success');
        }

    } catch (error) {
        console.error('Error loading saved game:', error);
        // Start fresh if loading fails
        gameState.gameId = generateGameId();
        gameState.currentStep = 1;
        gameState.maxStepReached = 1;
        gameState.startTime = Date.now();
        showNotification('เริ่มเกมใหม่!', 'success');
    }

    document.getElementById('landingPage').classList.add('hidden');
    const headerEl = document.getElementById('header');
    const stepBar = document.getElementById('stepUtilityBar');
    const playerBar = document.getElementById('playerStatusBar');
    const floatingActions = document.getElementById('floatingActionButtons');
    if (headerEl) {
        headerEl.classList.remove('hidden');
        refreshHeaderCompactState();
    }
    if (stepBar) {
        stepBar.classList.remove('hidden');
    }
    if (playerBar) {
        playerBar.classList.remove('hidden');
    }
    if (floatingActions) {
        floatingActions.classList.remove('hidden');
        floatingActions.classList.remove('show');
        floatingActions.setAttribute('aria-hidden', 'false');
    }
    document.getElementById('mainContent').classList.remove('hidden');
    const footer = document.getElementById('siteFooter');
    if (footer) footer.classList.remove('hidden');

    updatePlayerProfile();
    updateProgress();
    updateUserNameDisplay();
    await renderStep(gameState.currentStep);
}

// Update Progress
function updateProgress() {
    const totalSteps = 6;
    const logicalStep = gameState.currentStep === 2.5 ? 2 : gameState.currentStep;
    const currentProgress = ((logicalStep - 1) / (totalSteps - 1)) * 100;

    const progressFill = getElement('mainProgressFill');
    if (progressFill) {
        progressFill.style.width = `${currentProgress}%`;
    }

    updateText('progressText', `${Math.round(currentProgress)}%`);
}

// Calculate Level and EXP
function calculateLevel(exp) {
    const level = Math.floor(exp / 100) + 1;
    const expInCurrentLevel = exp % 100;
    const expToNextLevel = 100 - expInCurrentLevel;

    return {
        level: level,
        expInCurrentLevel: expInCurrentLevel,
        expToNextLevel: expToNextLevel
    };
}

// Update Player Profile Display
function updatePlayerProfile() {
    updateText('playerExp', playerProfile.exp);
    updateText('playerRank', playerProfile.rank);

    // Calculate level
    const levelInfo = calculateLevel(playerProfile.exp);
    playerProfile.level = levelInfo.level;
    playerProfile.expToNextLevel = levelInfo.expToNextLevel;

    // Update rank based on EXP and level
    if (playerProfile.level >= 10) playerProfile.rank = 'นักสืบเซียน';
    else if (playerProfile.level >= 5) playerProfile.rank = 'นักสืบชำนาญ';
    else if (playerProfile.level >= 2) playerProfile.rank = 'นักสืบฝึกหัด';
    else playerProfile.rank = 'มือใหม่';

    saveUserDataAsync();
    updateUserNameDisplay();
}

// Save User Data (Async)
async function saveUserDataAsync() {
    if (gameState.currentUser && gameState.userId) {
        const updatedUserData = {
            ...gameState.currentUser,
            exp: playerProfile.exp,
            rank: playerProfile.rank,
            level: playerProfile.level,
            totalGamesPlayed: playerProfile.totalGamesPlayed,
            bestScore: playerProfile.bestScore,
            lastPlayed: new Date().toISOString()
        };

        await saveUserData(updatedUserData);
        gameState.currentUser = updatedUserData;
    }
}

// Render Step Content
async function renderStep(step) {
    try {
                // Save current step to history (except when going back)
                if (step > gameState.currentStep) {
                    gameState.stepHistory.push(gameState.currentStep);
                }

                gameState.currentStep = step;
                const logicalStep = step === 2.5 ? 2 : step;
                gameState.maxStepReached = Math.max(gameState.maxStepReached || 1, logicalStep);
                updateStepIndicators();
                updateProgress();
                updateBackButton();

                const floatingActions = document.getElementById('floatingActionButtons');
                if (floatingActions) {
                    if (step === 6) {
                        floatingActions.classList.add('hidden');
                        floatingActions.classList.remove('show');
                        floatingActions.setAttribute('aria-hidden', 'true');
                    } else {
                        floatingActions.classList.remove('hidden');
                        floatingActions.setAttribute('aria-hidden', 'false');
                    }
                }

                // Auto-save progress
                saveCurrentGameState();

                const mainContent = document.getElementById('mainContent');
                const mission = MISSION_DATA.MISSION_01;

                switch(step) {
                    case 1:
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-6 md:p-8">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            📚 ${mission.historicalBackground.title}
                                        </h2>
                                        <p class="step-subtitle">หน้านี้เป็นการศึกษาประวัติศาสตร์เบื้องหลังของโคลงสี่สุภาพ เพื่อให้เข้าใจบริบทและความสำคัญของเหตุการณ์ก่อนเข้าสู่การศึกษาโคลง</p>
                                    </div>
                                </div>

                                <div class="mb-8">
                                    <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-6 mb-6">
                                        <div class="flex items-center gap-3 mb-4">
                                            <span class="text-3xl">📖</span>
                                            <h3 class="text-xl font-bold text-blue-900">ความรู้พื้นฐาน</h3>
                                        </div>
                                        <p class="text-blue-800 text-lg">อ่านประวัติศาสตร์เพื่อเตรียมความพร้อมก่อนศึกษาโคลง</p>
                                    </div>

                                    ${mission.historicalBackground.content}
                                </div>

                                <div class="text-center">
                                    <button id="proceedToPoem" class="modern-button px-8 py-4 text-xl rounded-2xl">
                                        ➡️ ไปดูโคลงสี่สุภาพ
                                    </button>
                                </div>
                            </div>
                        `;

                        const proceedButton = document.getElementById('proceedToPoem');
                        if (proceedButton) {
                            proceedButton.addEventListener('click', async () => {
                                await renderStep(2);
                            });
                        } else {
                            console.warn('Proceed button not found when rendering step 1');
                        }
                        break;

                    case 2.5:
                        // Matching Game Step
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-6 md:p-10 mt-4 md:mt-8 w-full max-w-6xl mx-auto">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            🎯 จับคู่คำศัพท์
                                        </h2>
                                        <p class="step-subtitle">เกมจับคู่คำศัพท์กับความหมาย เพื่อทบทวนและเสริมสร้างความจำ</p>
                                    </div>
                                </div>

                                <!-- Instructions -->
                                <div class="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-200 p-4 rounded-xl mb-6">
                                    <div class="flex items-center gap-2 mb-2">
                                        <span class="text-xl">📋</span>
                                        <h4 class="font-bold text-yellow-900">วิธีเล่น</h4>
                                    </div>
                                    <p class="text-yellow-800">ลากคำศัพท์จากด้านซ้ายไปวางบนความหมายที่ถูกต้องด้านขวา หรือคลิกคำศัพท์แล้วคลิกความหมาย</p>
                                </div>

                                <!-- Matching Game -->
                                <div class="grid gap-6 lg:grid-cols-2 mb-8">
                                    <!-- Words Column -->
                                    <div class="bg-gradient-to-br from-red-50 to-pink-50 border-2 border-red-200 p-5 rounded-xl h-full">
                                        <h3 class="text-lg font-bold text-red-900 mb-4 text-center">🔤 คำศัพท์</h3>
                                        <div id="wordsColumn" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            ${Object.keys(MISSION_DATA.MISSION_01.hardWords).map((word, index) => `
                                                <div class="word-item bg-gradient-to-r from-red-400 to-red-500 text-white border-2 border-red-600 p-3 rounded-xl cursor-pointer hover:from-red-500 hover:to-red-600 transition-all duration-200 text-center font-bold shadow-lg"
                                                     data-word="${word}" draggable="true">
                                                    <div class="flex flex-col items-center justify-center gap-2">
                                                        <img src="${getWordImage(word)}" alt="${word}" class="w-16 h-16 md:w-20 md:h-20 rounded-lg border-2 border-white object-cover shadow-md">
                                                        <span class="text-sm">${word}</span>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>

                                    <!-- Meanings Column -->
                                    <div class="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 p-5 rounded-xl h-full">
                                        <h3 class="text-lg font-bold text-green-900 mb-4 text-center">💭 ความหมาย</h3>
                                        <div id="meaningsColumn" class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            ${Object.entries(MISSION_DATA.MISSION_01.hardWords).sort(() => Math.random() - 0.5).map(([word, data]) => `
                                                <div class="meaning-item bg-white border-2 border-green-300 p-3 rounded-xl min-h-[80px] flex items-center justify-center text-center text-green-800 border-dashed hover:bg-green-50 transition-all duration-200"
                                                     data-word="${word}">
                                                    <span class="font-semibold text-sm">${data.meaning.split(',')[0].trim()}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                </div>

                                <div class="flex flex-col md:flex-row justify-center gap-4 mt-4 md:mt-6">
                                    <button onclick="goBack()" class="modern-button px-6 md:px-8 py-3 md:py-4 text-lg md:text-xl rounded-2xl bg-gray-500 hover:bg-gray-600 w-full md:w-auto">
                                        ← ย้อนกลับ
                                    </button>
                                    <button id="resetMatching" class="modern-button px-6 md:px-8 py-3 md:py-4 text-lg md:text-xl rounded-2xl bg-orange-500 hover:bg-orange-600 w-full md:w-auto">
                                        🔄 เริ่มใหม่
                                    </button>
                                    <button id="finishMatching" class="modern-button px-8 md:px-12 py-3 md:py-4 text-lg md:text-xl rounded-2xl w-full md:w-auto" disabled>
                                        ➡️ ไปขั้นตอนถัดไป
                                    </button>
                                </div>

                                <!-- Score Display -->
                                <div class="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 p-4 rounded-xl mt-8 text-center">
                                    <h3 class="text-lg font-bold text-blue-900 mb-2">คะแนน</h3>
                                    <div class="text-3xl font-bold text-blue-600" id="matchingScore">0</div>
                                    <div class="text-sm text-blue-700">จาก ${Object.keys(MISSION_DATA.MISSION_01.hardWords).length} คู่</div>
                                </div>
                            </div>
                        `;
                        setupMatchingGame();
                        break;

                    case 2:
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-6 md:p-8">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            📜 โคลงสี่สุภาพ - พระราชพงศาวดาร
                                        </h2>
                                        <p class="step-subtitle">หน้านี้เป็นการศึกษาโคลงสี่สุภาพและค้นหาความหมายของคำศัพท์ยาก เพื่อฝึกทักษะการสืบค้นข้อมูลและเข้าใจความหมายของวรรณคดี</p>
                                    </div>
                                </div>

                                <div class="bg-white/85 border border-blue-200 rounded-2xl p-4 mb-6 shadow-sm">
                                    <h3 class="text-base font-semibold text-blue-900 mb-1">🎯 คำสั่ง</h3>
                                    <p class="text-sm text-blue-700">คลิกคำศัพท์สีน้ำเงินในโคลง แล้วค้นหาความหมายให้ครบทั้ง ${Object.keys(mission.hardWords).length} คำ พร้อมบันทึกแหล่งอ้างอิง</p>
                                </div>

                                <div class="mb-4 text-center">
                                    <span class="badge-modern inline-flex items-center justify-center">โคลงสี่สุภาพ</span>
                                </div>
                                <div class="poem-container p-6 mb-6 mx-auto max-w-3xl">
                                    <div class="poem-text text-gray-800">
                                        ${mission.poem}
                                    </div>
                                </div>

                                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-6 mb-6">
                                    <div class="text-center">
                                        <div class="text-5xl mb-4">📚</div>
                                        <h3 class="text-xl font-bold text-blue-900 mb-4">เครื่องมือค้นหาความหมาย</h3>
                                        <p class="text-blue-800 text-center mb-6">เลือกเครื่องมือที่ต้องการใช้ค้นหาความหมายคำศัพท์</p>

                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <button onclick="openDictionaryNewTab()" class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3">
                                                <span class="text-2xl">📖</span>
                                                <span>พจนานุกรมราชบัณฑิตยสถาน</span>
                                            </button>
                                            <button onclick="showKloangInfo()" class="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-3">
                                                <span class="text-2xl">📋</span>
                                                <span>ฉันทลักษณ์โคลงสี่สุภาพ</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-6 mb-6">
                                    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                        <div class="flex items-center gap-3">
                                            <span class="text-3xl">🧭</span>
                                            <div>
                                                <h3 class="text-lg font-bold text-blue-900">แนวทางการสืบค้น</h3>
                                                <p class="text-blue-800 text-sm md:text-base">รวบรวมคำศัพท์สำคัญ ตรวจสอบแหล่งข้อมูล และบันทึกความหมายพร้อมอ้างอิง</p>
                                            </div>
                                        </div>
                                        <div class="flex gap-3">
                                            <div class="px-4 py-2 rounded-xl bg-white border border-blue-200 text-center">
                                                <p class="text-xs text-blue-500">คำศัพท์ทั้งหมด</p>
                                                <p class="text-lg font-semibold text-blue-700">${Object.keys(mission.hardWords).length} คำ</p>
                                            </div>
                                            <div class="px-4 py-2 rounded-xl bg-white border border-indigo-200 text-center">
                                                <p class="text-xs text-indigo-500">อ้างอิงที่แนะนำ</p>
                                                <p class="text-lg font-semibold text-indigo-700">พจนานุกรมราชบัณฑิตฯ</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Progress Cards -->
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                    <div class="modern-card rounded-xl p-4 text-center">
                                        <p class="text-gray-600 text-sm mb-2">เป้าหมาย</p>
                                        <p class="text-xl font-bold text-blue-600">${Object.keys(mission.hardWords).length} คำ</p>
                                        <div class="progress-bar mt-3 bg-gray-200 h-3">
                                            <div id="wordProgress" class="progress-fill h-3" style="width: 0%"></div>
                                        </div>
                                    </div>
                                    <div class="modern-card rounded-xl p-4 text-center">
                                        <p class="text-gray-600 text-sm mb-2">ค้นพบแล้ว</p>
                                        <p class="text-xl font-bold text-green-600"><span id="foundWords">0</span> คำ</p>
                                    </div>
                                    <div class="modern-card rounded-xl p-4 text-center">
                                        <p class="text-gray-600 text-sm mb-2">คำตอบผิด</p>
                                        <p class="text-xl font-bold text-red-600"><span id="incorrectWords">0</span> คำ</p>
                                    </div>
                                </div>

                                <!-- Next Button (Hidden initially) -->
                                <div class="text-center space-y-4">
                                    <button id="nextToMatching" class="modern-button cta-float px-8 py-4 text-xl rounded-2xl hidden" onclick="showMatchingGame()">
                                        🎯 ไปจับคู่คำศัพท์
                                    </button>
                                </div>
                            </div>
                        `;
                        attachWordClickHandlers();
                        // Load saved data and update UI
                        setTimeout(() => {
                            updateWordStatesFromData();
                            updateWordCounts();
                            checkAllWordsFound();
                        }, 100);
                        break;

                    case 3:
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-4 md:p-8 space-y-6">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            📝 ถอดความและจินตนาการ
                                        </h2>
                                        <p class="step-subtitle">ฝึกถอดความโคลงและใช้จินตนาการเพื่อสื่อสารความเข้าใจด้วยภาษาของตนเอง</p>
                                    </div>
                                </div>

                                <div class="mb-2 text-center lg:text-left">
                                    <span class="badge-modern inline-flex items-center justify-center">โคลงสี่สุภาพ - อ้างอิง</span>
                                </div>

                                <div class="grid gap-6 lg:grid-cols-2 items-start">
                                    <div class="space-y-4">
                                        <div class="poem-container plain-poem h-full mx-auto lg:mx-0">
                                            <div class="poem-text text-gray-800 text-base md:text-lg">
                                                ${mission.poem}
                                            </div>
                                        </div>
                                    </div>

                                    <div class="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 p-6 rounded-2xl h-full flex flex-col">
                                        <h3 class="text-xl font-bold text-green-900 mb-4">📝 ถอดความ</h3>
                                        <p class="text-green-800 mb-4">ถอดความโคลงเป็นร้อยแก้วด้วยภาษาของคุณเอง</p>
                                        <textarea id="interpretationInput" class="w-full min-h-[14rem] lg:min-h-[18rem] modern-input p-4 text-base resize-none flex-1" placeholder="บันทึกความหมายของโคลงในรูปแบบร้อยแก้วด้วยคำของคุณ"></textarea>
                                    </div>
                                </div>

                                <div class="bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 p-6 rounded-2xl">
                                    <h3 class="text-xl font-bold text-purple-900 mb-4">🎨 จินตนาการภาพ</h3>
                                    <p class="text-purple-800 mb-4">บรรยายภาพที่เกิดขึ้นในจินตนาการของคุณจากโคลงนี้</p>
                                    <textarea id="imaginationInput" class="w-full h-40 modern-input p-4 text-base resize-none" placeholder="🖼️ วาดภาพด้วยคำพูด บอกเล่าภาพที่ปรากฏในใจของคุณ"></textarea>
                                </div>

                                <div class="text-center space-y-4">
                                    <div class="flex flex-col md:flex-row justify-center gap-4">
                                        <button onclick="goBack()" class="modern-button px-6 py-3 text-lg rounded-2xl bg-gray-500 hover:bg-gray-600 w-full md:w-auto">
                                            ← ย้อนกลับ
                                        </button>
                                        <button id="nextStep3" class="modern-button px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl w-full md:w-auto" disabled>
                                            ➡️ ไปขั้นตอนถัดไป
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                        setupStep3Handlers();
                        break;

                    case 4:
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-6 md:p-8">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            🖼️ เปิดเผยภาพจริง
                                        </h2>
                                        <p class="step-subtitle">เปรียบเทียบจินตนาการกับหลักฐานประวัติศาสตร์ เพื่อยืนยันความเข้าใจในเนื้อเรื่อง</p>
                                    </div>
                                </div>

                                <!-- Historical Image -->
                                <div class="text-center mb-8">
                                    <h3 class="text-xl font-bold text-blue-900 mb-6">ภาพจริงจากประวัติศาสตร์</h3>
                                    <div class="relative max-w-4xl mx-auto">
                                        <div class="relative cursor-pointer" id="imageContainer">
                                            <img id="historicalImage" src="${mission.officialImageURL}" alt="ภาพการต่อสู้ของสมเด็จพระสุริโยทัย" class="w-full aspect-video object-cover rounded-2xl border-2 border-gray-300 shadow-xl blur-lg transition-all duration-1000" onerror="this.src=''; this.alt='ไม่สามารถโหลดภาพได้'; this.style.display='none';">
                                            <div id="imageOverlay" class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-2xl transition-opacity duration-1000">
                                                <div class="text-white text-center">
                                                    <div class="text-4xl mb-2 animate-bounce">👆</div>
                                                    <p class="text-lg font-bold">คลิกหรือลูบเพื่อเปิดเผยภาพ</p>
                                                    <p class="text-sm mt-2 opacity-75">ลากเมาส์หรือนิ้วบนภาพ</p>
                                                </div>
                                            </div>
                                            <canvas id="revealCanvas" class="absolute inset-0 w-full h-full rounded-2xl pointer-events-none opacity-0"></canvas>
                                        </div>
                                    </div>
                                    <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 p-6 rounded-2xl mt-6 max-w-4xl mx-auto">
                                        <p class="text-blue-800 text-lg italic">${mission.officialImageDescription}</p>
                                    </div>
                                </div>

                                <!-- Comparison Button -->
                                <div class="text-center mb-8">
                                    <button id="showComparison" class="modern-button px-8 py-4 text-xl rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600">
                                        💡 ความจริงก็คือ...
                                    </button>
                                </div>

                                <!-- Comparison Section (Hidden initially) -->
                                <div id="comparisonSection" class="hidden mb-8">
                                    <h3 class="text-xl font-bold text-purple-900 mb-6">เทียบภาพกับความจริง</h3>

                                    <div class="space-y-6">
                                        <div class="bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 p-6 rounded-2xl">
                                            <h4 class="font-bold text-purple-800 mb-4 text-lg">🎨 ที่คุณจินตนาการไว้:</h4>
                                            <p class="text-purple-700 text-lg leading-relaxed">${gameState.imaginationText}</p>
                                        </div>

                                        <div class="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 p-6 rounded-2xl">
                                            <h4 class="font-bold text-green-800 mb-4 text-lg">📝 ที่คุณถอดความได้:</h4>
                                            <p class="text-green-700 text-lg leading-relaxed">${gameState.interpretationText}</p>
                                        </div>

                                        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 p-6 rounded-2xl">
                                            <h4 class="font-bold text-blue-800 mb-4 text-lg">📚 ถอดความที่ถูกต้อง:</h4>
                                            <p class="text-blue-700 text-lg leading-relaxed">${mission.correctInterpretation}</p>
                                        </div>
                                    </div>
                                </div>

                                <div class="text-center space-y-4">
                                    <div class="flex flex-col md:flex-row justify-center gap-4">
                                        <button onclick="goBack()" class="modern-button px-6 py-3 text-lg rounded-2xl bg-gray-500 hover:bg-gray-600 w-full md:w-auto">
                                            ← ย้อนกลับ
                                        </button>
                                        <button id="nextStep4" class="modern-button px-8 py-3 text-lg rounded-2xl w-full md:w-auto">
                                            ➡️ ไปขั้นตอนทบทวน
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `;
                        setupStep4Handlers();
                        // Setup image reveal effect
                        setTimeout(setupImageReveal, 100);
                        break;

                    case 5:
                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-4 md:p-10 mt-4 md:mt-8">
                                <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4">
                                    <div>
                                        <h2 class="text-2xl md:text-3xl font-bold text-gray-900">
                                            📝 ทบทวนความรู้
                                        </h2>
                                        <p class="step-subtitle">ทดสอบความเข้าใจเกี่ยวกับคำศัพท์และเนื้อหาเพื่อสรุปผลการเรียนรู้</p>
                                    </div>
                                </div>

                                <!-- Score Display -->
                                <div class="bg-gradient-to-r from-blue-50 to-green-50 border-2 border-blue-200 p-4 rounded-xl mb-6 text-center">
                                    <h3 class="text-lg font-bold text-blue-900 mb-2">คะแนน</h3>
                                    <div class="text-3xl font-bold text-blue-600" id="quizScore">0</div>
                                    <div class="text-sm text-blue-700">จาก ${mission.comprehensionQuestions.length} ข้อ</div>
                                </div>

                                <!-- Quiz Questions -->
                                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                                    ${mission.comprehensionQuestions.map((q, index) => `
                                        <div class="bg-gradient-to-br from-white to-gray-50 border-2 border-gray-200 p-4 rounded-xl">
                                            <h4 class="font-bold text-gray-900 mb-3">ข้อ ${index + 1}. ${q.question}</h4>
                                            <div class="space-y-2">
                                                ${q.options.map((option, optIndex) => `
                                                    <label class="flex items-center p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors duration-200">
                                                        <input type="radio" name="question_${index}" value="${optIndex}" class="mr-3 text-blue-600">
                                                        <span class="text-gray-700">${option}</span>
                                                    </label>
                                                `).join('')}
                                            </div>
                                            <div id="result_${index}" class="mt-3 hidden"></div>
                                        </div>
                                    `).join('')}
                                </div>

                                <div class="flex flex-col md:flex-row justify-center gap-4 mt-6 md:mt-10">
                                    <button onclick="goBack()" class="modern-button px-6 md:px-8 py-3 md:py-4 text-lg md:text-xl rounded-2xl bg-gray-500 hover:bg-gray-600 w-full md:w-auto">
                                        ← ย้อนกลับ
                                    </button>
                                    <button id="checkAnswers" class="modern-button px-8 md:px-12 py-3 md:py-4 text-lg md:text-xl rounded-2xl w-full md:w-auto" onclick="checkQuizAnswers()">
                                        ✅ ตรวจคำตอบ
                                    </button>
                                    <button id="retryQuiz" class="modern-button px-8 md:px-12 py-3 md:py-4 text-lg md:text-xl rounded-2xl w-full md:w-auto bg-orange-500 hover:bg-orange-600 hidden" onclick="retryQuiz()">
                                        🔄 ทำใหม่
                                    </button>
                                    <button id="finishQuiz" class="modern-button px-8 md:px-12 py-3 md:py-4 text-lg md:text-xl rounded-2xl w-full md:w-auto hidden" onclick="finishQuiz()">
                                        ➡️ เสร็จสิ้น
                                    </button>
                                </div>
                            </div>
                        `;
                        setupQuiz();
                        break;

                    case 6:
                        const finalScore = await calculateFinalScore();
                        updatePlayerProfile();
                        const rankingInfo = await computePlayerRanking(finalScore.total);
                        const praiseMessage = finalScore.total >= 900
                            ? 'ยอดเยี่ยม! คุณรักษามาตรฐานระดับนักสืบเซียนได้อย่างมั่นคง'
                            : finalScore.total >= 600
                                ? 'ทำได้ดีมาก การวิเคราะห์ของคุณมีความแม่นยำและครบถ้วน'
                                : 'ยังคงมีพัฒนาการที่ดีต่อเนื่อง ขอให้เพิ่มการทบทวนอีกเล็กน้อย';
                        const focusMessage = finalScore.comprehension >= finalScore.vocabulary
                            ? 'เน้นย้ำการสืบค้นคำศัพท์เพิ่มเติมเพื่อเพิ่มความหลากหลายของแหล่งอ้างอิง'
                            : 'เสริมการวิเคราะห์เชิงลึกในส่วนถอดความเพื่อยกระดับความเข้าใจเชิงโครงสร้าง';

                        mainContent.innerHTML = `
                            <div class="modern-card rounded-3xl p-4 md:p-10 mt-4 md:mt-8 space-y-10">
                                <div class="text-center space-y-3">
                                    <div class="text-6xl md:text-7xl">🏅</div>
                                    <h2 class="text-3xl md:text-4xl font-bold text-gray-900">รายงานสรุปผลการเรียนรู้</h2>
                                    <p class="text-base md:text-lg text-gray-600">ผู้เรียนได้ผ่านกิจกรรม “ไขรหัสวรรณคดี” ครบถ้วนและได้รับการประเมินตามเกณฑ์ของหลักสูตร</p>
                                    <p class="text-sm text-indigo-600 font-semibold">${praiseMessage}</p>
                                </div>

                                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <div class="lg:col-span-2 bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 p-6 rounded-2xl">
                                        <h3 class="text-xl font-bold text-blue-900 mb-4">สรุปคะแนน</h3>
                                        <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                                            <div>
                                                <p class="text-sm text-blue-700">คะแนนรวมสะสม</p>
                                                <p class="text-4xl font-extrabold text-blue-600">${finalScore.total} คะแนน</p>
                                            </div>
                                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
                                                <div class="rounded-xl bg-white/90 border border-blue-100 p-3 text-center">
                                                    <p class="text-xs text-slate-500">สืบค้นคำศัพท์</p>
                                                    <p class="text-lg font-semibold text-blue-700">+${finalScore.vocabulary}</p>
                                                </div>
                                                <div class="rounded-xl bg-white/90 border border-blue-100 p-3 text-center">
                                                    <p class="text-xs text-slate-500">ความเข้าใจเนื้อหา</p>
                                                    <p class="text-lg font-semibold text-blue-700">+${finalScore.comprehension}</p>
                                                </div>
                                                <div class="rounded-xl bg-white/90 border border-blue-100 p-3 text-center">
                                                    <p class="text-xs text-slate-500">โบนัสเวลา</p>
                                                    <p class="text-lg font-semibold text-blue-700">+${finalScore.timeBonus}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="bg-gradient-to-br from-emerald-50 to-amber-50 border-2 border-emerald-200 p-6 rounded-2xl space-y-3">
                                        <h3 class="text-xl font-bold text-emerald-900">ข้อมูลผู้เรียน</h3>
                                        <p class="text-sm text-gray-600 leading-relaxed">${gameState.currentUser?.name || 'ผู้เรียน'} (${playerProfile.rank})<br>EXP สะสม ${playerProfile.exp} | ระดับชั้น ${gameState.currentUser?.grade || '-'} / เลขที่ ${gameState.currentUser?.number || '-'} </p>
                                        <div class="grid grid-cols-2 gap-3 text-sm">
                                            <div class="rounded-lg bg-white/90 border border-emerald-200 p-3">
                                                <p class="text-xs text-emerald-600 uppercase tracking-wide">เลเวล</p>
                                                <p class="text-xl font-bold text-emerald-700">Lv.${playerProfile.level}</p>
                                            </div>
                                            <div class="rounded-lg bg-white/90 border border-emerald-200 p-3">
                                                <p class="text-xs text-emerald-600 uppercase tracking-wide">อันดับในระบบ</p>
                                                <p class="text-lg font-semibold text-emerald-700">อันดับที่ ${rankingInfo.position.toLocaleString('th-TH')} จาก ${rankingInfo.total.toLocaleString('th-TH')} คน</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="bg-white/85 border border-indigo-100 rounded-2xl p-6 space-y-3">
                                    <h3 class="text-lg font-bold text-indigo-900">วิเคราะห์ผู้เรียน</h3>
                                    <p class="text-sm text-gray-700 leading-relaxed">${focusMessage}</p>
                                    <ul class="list-disc list-inside text-sm text-slate-600 space-y-1">
                                        <li>ผลงานเด่น: การสืบค้นคำศัพท์ได้ ${Object.keys(gameState.translatedWords || {}).length} คำ พร้อมอ้างอิงครบถ้วน</li>
                                        <li>การถอดความ: ${gameState.interpretationText?.length > 0 ? 'มีการอธิบายสาระสำคัญครบถ้วน' : 'ควรเพิ่มเติมการขยายความให้ชัดเจน'}</li>
                                        <li>การใช้จินตนาการ: ${gameState.imaginationText?.length > 0 ? 'บรรยายภาพได้เชื่อมโยงกับประวัติศาสตร์' : 'แนะนำให้เพิ่มรายละเอียดเชิงภาพเพื่อเสริมมิติการตีความ'}</li>
                                    </ul>
                                </div>

                                <div class="bg-gradient-to-r from-slate-900 to-indigo-900 rounded-2xl p-6 text-white space-y-2">
                                    <h3 class="text-lg font-semibold">คำชื่นชม</h3>
                                    <p class="text-sm leading-relaxed">ขอชื่นชมความตั้งใจและความสม่ำเสมอในการเรียนรู้วรรณคดีไทย คุณสามารถเชื่อมโยงข้อมูลจากหลายแหล่งและถ่ายทอดออกมาได้อย่างเป็นระบบ</p>
                                </div>

                                <div class="summary-action-bar">
                                    <button type="button" onclick="playAgain()" class="modern-button px-6 md:px-10 py-3 md:py-4 text-lg md:text-xl rounded-2xl">
                                        🔁 เล่นอีกครั้ง
                                    </button>
                                    <button type="button" onclick="showCertificate()" class="modern-button px-6 md:px-10 py-3 md:py-4 text-lg md:text-xl rounded-2xl bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500 hover:from-yellow-500 hover:to-orange-600">
                                        🏆 รับเกียรติบัตร
                                    </button>
                                </div>
                            </div>
                        `;
                        break;
                }
    } catch (error) {
        console.error('Failed to render step', error);
        showNotification('ไม่สามารถแสดงขั้นตอนนี้ได้', 'error');
        if (error && typeof error === 'object') {
            error.silent = true;
        }
        throw error;
    }
}

// Update Back Button
function updateBackButton() {
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        if (gameState.currentStep > 1 || gameState.stepHistory.length > 0) {
            backBtn.classList.remove('hidden');
        } else {
            backBtn.classList.add('hidden');
        }
    }
}

// Update Step Indicators
function updateStepIndicators() {
    const rawStep = Number(gameState.currentStep || 1);
    const chips = document.querySelectorAll('#stepIndicatorContainer .step-chip');
    const normalizedStep = rawStep === 2.5 ? 2 : rawStep;
    const effectiveStep = Number.isFinite(normalizedStep) ? normalizedStep : 1;

    chips.forEach(chip => {
        const chipStep = parseFloat(chip.dataset.step || '0');
        chip.classList.remove('step-chip-active', 'step-chip-completed');

        if (Math.abs(chipStep - effectiveStep) < 0.01) {
            chip.classList.add('step-chip-active');
        } else if (chipStep < effectiveStep) {
            chip.classList.add('step-chip-completed');
        }
    });

    const currentStepLabel = document.getElementById('currentStepLabel');
    if (currentStepLabel) {
        currentStepLabel.textContent = getStepLabel(rawStep);
    }
}

function initializeStepChipEvents() {
    const container = document.getElementById('stepIndicatorContainer');
    if (!container || stepChipEventsInitialized) return;

    container.querySelectorAll('.step-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const stepValue = parseFloat(chip.dataset.step || '0');
            if (!Number.isFinite(stepValue)) return;
            const logicalStep = stepValue === 2.5 ? 2 : stepValue;
            const currentLogical = gameState.currentStep === 2.5 ? 2 : gameState.currentStep;

            if (logicalStep > (gameState.maxStepReached || 1)) return;
            if (logicalStep === currentLogical) return;

            goToStep(stepValue).catch(error => {
                console.error('Failed to navigate via step chip:', error);
                showNotification('ไม่สามารถเปิดขั้นตอนนี้ได้', 'error');
            });
        });
    });
    stepChipEventsInitialized = true;
}

function initializeFloatingActions() {
    const floatingActions = document.getElementById('floatingActionButtons');
    const toggleButton = document.getElementById('floatingActionsToggle');
    if (!floatingActions || !toggleButton || floatingActionsInitialized) return;

    const panel = floatingActions.querySelector('.floating-panel');
    const closePanel = () => floatingActions.classList.remove('show');

    toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        floatingActions.classList.toggle('show');
    });

    if (panel) {
        panel.addEventListener('mouseleave', closePanel);
    }

    floatingActions.querySelectorAll('.floating-action-button').forEach(button => {
        button.addEventListener('click', () => {
            setTimeout(closePanel, 150);
        });
    });

    if (floatingActionsDocHandler) {
        document.removeEventListener('click', floatingActionsDocHandler);
    }

    floatingActionsDocHandler = (event) => {
        if (!floatingActions.contains(event.target)) {
            closePanel();
        }
    };

    document.addEventListener('click', floatingActionsDocHandler);
    floatingActionsInitialized = true;
}

function refreshHeaderCompactState() {
    const header = document.getElementById('header');
    if (!header || header.classList.contains('hidden')) return;
    if (window.scrollY > 120) {
        header.classList.add('header-compact');
    } else {
        header.classList.remove('header-compact');
    }
}

window.addEventListener('scroll', () => {
    window.requestAnimationFrame(refreshHeaderCompactState);
}, { passive: true });

// Attach Word Click Handlers
function attachWordClickHandlers() {
    const words = document.querySelectorAll('.word-to-find');
    words.forEach(word => {
        word.addEventListener('click', (event) => handleWordClick(word.dataset.word, event));
    });
}

// Handle Word Click
function handleWordClick(word, event) {
    gameState.selectedWord = word;
    const mission = MISSION_DATA.MISSION_01;

    // Remove any existing tooltips
    const existingTooltip = document.getElementById('wordTooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    // Get the clicked element position
    const clickedElement = event.target;
    const rect = clickedElement.getBoundingClientRect();

    // Create floating tooltip
    const tooltip = document.createElement('div');
    tooltip.id = 'wordTooltip';
    tooltip.className = 'fixed z-50 tooltip-modern p-4 md:p-8 max-w-sm md:max-w-lg animate-bounce-in';

    // Always position in center for better UX
    tooltip.style.cssText = `
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 90vw;
        max-height: 80vh;
        overflow-y: auto;
    `;

    tooltip.innerHTML = `
        <div class="relative">
            <button onclick="closeTooltip()" class="absolute -top-2 -right-2 w-8 h-8 md:w-10 md:h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold transition-all duration-200 shadow-lg text-sm md:text-base">
                ×
            </button>

            <div class="mb-4 md:mb-6">
                <div class="flex items-center gap-3 mb-3 md:mb-4">
                    <span class="text-2xl md:text-3xl">🔍</span>
                    <h3 class="text-lg md:text-xl font-bold text-gray-900">ค้นหาความหมาย</h3>
                </div>
                <div class="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 p-3 md:p-4 rounded-xl text-center">
                    <p class="text-xl md:text-2xl font-bold text-blue-600">"${word}"</p>
                </div>
            </div>

            <div class="space-y-4 md:space-y-6">
                <div>
                    <label class="block text-gray-700 mb-2 md:mb-3 font-semibold text-sm md:text-base">💭 ความหมาย</label>
                    <input type="text" id="wordTranslation" class="w-full modern-input p-3 md:p-4 text-sm md:text-base" placeholder="กรอกความหมายที่คุณค้นพบ...">
                </div>

                <div>
                    <label class="block text-gray-700 mb-2 md:mb-3 font-semibold text-sm md:text-base">📚 แหล่งอ้างอิง</label>
                    <select id="referenceType" class="w-full modern-input p-3 md:p-4 text-sm md:text-base mb-3" onchange="toggleReferenceInput()">
                        <option value="">เลือกแหล่งอ้างอิง</option>
                        <option value="ความรู้เดิม">ความรู้เดิม</option>
                        <option value="ค้นหามา">ค้นหามา</option>
                    </select>
                    <input type="text" id="wordReference" class="w-full modern-input p-3 md:p-4 text-sm md:text-base hidden" placeholder="ระบุแหล่งที่มา เช่น พจนานุกรม ราชบัณฑิตยสถาน, เว็บไซต์, หนังสือ">
                </div>
            </div>

            <div class="flex gap-3 md:gap-4 mt-6 md:mt-8">
                <button onclick="closeTooltip()" class="flex-1 bg-gray-500 hover:bg-gray-600 text-white px-4 md:px-6 py-2 md:py-3 rounded-xl font-semibold transition-all duration-200 text-sm md:text-base">
                    ยกเลิก
                </button>
                <button onclick="validateWord()" class="flex-1 modern-button px-4 md:px-6 py-2 md:py-3 rounded-xl text-sm md:text-base">
                    ส่งคำตอบ
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(tooltip);

    // Adjust position if tooltip goes off screen (desktop only)
    if (window.innerWidth > 768) {
        setTimeout(() => {
            const tooltipRect = tooltip.getBoundingClientRect();
            if (tooltipRect.right > window.innerWidth) {
                tooltip.style.left = (rect.left - tooltipRect.width - 15) + 'px';
            }
            if (tooltipRect.bottom > window.innerHeight) {
                tooltip.style.top = (rect.bottom - tooltipRect.height) + 'px';
            }
            if (tooltipRect.top < 0) {
                tooltip.style.top = '10px';
            }
        }, 10);
    }
}

// Toggle Reference Input
function toggleReferenceInput() {
    const referenceType = document.getElementById('referenceType').value;
    const referenceInput = document.getElementById('wordReference');

    if (referenceType === 'ค้นหามา') {
        referenceInput.classList.remove('hidden');
        referenceInput.required = true;
    } else {
        referenceInput.classList.add('hidden');
        referenceInput.required = false;
        referenceInput.value = '';
    }
}

// Validate Word Translation
async function validateWord() {
    try {
        const translation = document.getElementById('wordTranslation').value.trim();
        const referenceType = document.getElementById('referenceType').value;
        const referenceInput = document.getElementById('wordReference').value.trim();
        const mission = MISSION_DATA.MISSION_01;
        const correctMeaning = mission.hardWords[gameState.selectedWord].meaning;

        // Validation checks
        if (!translation || translation.length < 2) {
            showNotification('กรุณากรอกความหมายของคำศัพท์', 'error');
            return;
        }

        if (!referenceType) {
            showNotification('กรุณาเลือกแหล่งอ้างอิง', 'error');
            return;
        }

        if (referenceType === 'ค้นหามา' && (!referenceInput || referenceInput.trim() === '')) {
            showNotification('กรุณาระบุแหล่งที่มาของการค้นหา', 'error');
            return;
        }

        const finalReference = referenceType === 'รู้อยู่แล้ว' ? 'รู้อยู่แล้ว' : referenceInput;

        // Check if translation contains key concepts (more flexible matching)
        const correctMeanings = mission.hardWords[gameState.selectedWord].meaning.split(',').map(m => m.trim());
        const hasKeyword = correctMeanings.some(meaning => {
            const keywords = meaning.split(' ');
            return keywords.some(keyword => 
                translation.toLowerCase().includes(keyword.toLowerCase()) ||
                keyword.toLowerCase().includes(translation.toLowerCase()) ||
                translation.toLowerCase() === meaning.toLowerCase()
            );
        });

        const wordElement = document.querySelector(`[data-word="${gameState.selectedWord}"]`);

        if (!hasKeyword) {
            // Track incorrect attempts
            if (!gameState.wordAttempts[gameState.selectedWord]) {
                gameState.wordAttempts[gameState.selectedWord] = 0;
            }
            gameState.wordAttempts[gameState.selectedWord]++;

            // Mark as incorrect
            gameState.incorrectWords[gameState.selectedWord] = {
                translation: translation,
                reference: finalReference,
                timestamp: new Date().toISOString(),
                correctMeaning: correctMeaning,
                attempts: gameState.wordAttempts[gameState.selectedWord]
            };

            if (wordElement) {
                wordElement.className = 'word-incorrect';
            }

            // Save immediately to database
            await saveCurrentGameState();
            await saveAllUserAnswers();

            // Show hint image after 2 incorrect attempts
            let hintMessage = `คำแปลยังไม่ถูกต้อง ลองดูใบ้ประกอบ`;
            if (gameState.wordAttempts[gameState.selectedWord] >= 2) {
                hintMessage += ` (ดูรูปภาพใบ้ที่ปรากฏ)`;

                // Add floating hint image to the word in the poem
                const hintImageContainer = document.createElement('div');
                hintImageContainer.className = 'absolute z-10 hint-image';
                hintImageContainer.style.cssText = `
                    top: -80px;
                    left: 50%;
                    transform: translateX(-50%);
                    pointer-events: none;
                `;
                hintImageContainer.innerHTML = `
                    <div class="relative">
                        <img src="${getWordImage(gameState.selectedWord)}" alt="ใบ้สำหรับ ${gameState.selectedWord}" 
                             class="w-16 h-16 md:w-20 md:h-20 rounded-xl border-4 border-yellow-400 object-cover shadow-2xl animate-pulse bg-white p-1">
                        <div class="absolute -top-2 -right-2 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center text-xs font-bold text-yellow-900">💡</div>
                    </div>
                `;

                // Insert hint image as floating element
                if (wordElement && !wordElement.parentElement.querySelector('.hint-image')) {
                    wordElement.parentElement.style.position = 'relative';
                    wordElement.parentElement.appendChild(hintImageContainer);
                }
            }

            showNotification(hintMessage, 'error');
            updateWordCounts();
            closeTooltip();
            return;
        }

        // Mark word as translated correctly
        gameState.translatedWords[gameState.selectedWord] = {
            translation: translation,
            reference: finalReference,
            points: mission.hardWords[gameState.selectedWord].points,
            timestamp: new Date().toISOString(),
            correctMeaning: correctMeaning
        };

        // Remove from incorrect if it was there
        delete gameState.incorrectWords[gameState.selectedWord];

        // Update UI
        if (wordElement) {
            wordElement.className = 'word-correct';
        }

        // Save immediately to database
        await saveCurrentGameState();
        await saveAllUserAnswers();

        updateWordCounts();
        showNotification(`🎉 ถูกต้อง! +${mission.hardWords[gameState.selectedWord].points} คะแนน`, 'success');
        closeTooltip();

        // Check if all words are translated
        const foundWordsCount = Object.keys(gameState.translatedWords).length;
        const totalWords = Object.keys(mission.hardWords).length;

        if (foundWordsCount === totalWords) {
            setTimeout(() => {
                showNotification('🚀 ค้นพบครบทุกคำแล้ว!', 'success');
                checkAllWordsFound();
            }, 1000);
        }

    } catch (error) {
        console.error('Error validating word:', error);
        showNotification('เกิดข้อผิดพลาดในการตรวจสอบคำตอบ', 'error');
    }
}

// Update Word Counts
function updateWordCounts() {
    const mission = MISSION_DATA.MISSION_01;
    const foundWordsCount = Object.keys(gameState.translatedWords).length;
    const incorrectWordsCount = Object.keys(gameState.incorrectWords).length;
    const totalWords = Object.keys(mission.hardWords).length;
    const progressPercent = (foundWordsCount / totalWords) * 100;

    const foundWordsElement = document.getElementById('foundWords');
    const incorrectWordsElement = document.getElementById('incorrectWords');
    const progressFill = document.getElementById('wordProgress');

    if (foundWordsElement) {
        foundWordsElement.textContent = foundWordsCount;
    }
    if (incorrectWordsElement) {
        incorrectWordsElement.textContent = incorrectWordsCount;
    }
    if (progressFill) {
        progressFill.style.width = progressPercent + '%';
    }
}

// Check if all words are found
function checkAllWordsFound() {
    const mission = MISSION_DATA.MISSION_01;
    const foundWordsCount = Object.keys(gameState.translatedWords).length;
    const totalWords = Object.keys(mission.hardWords).length;

    const nextButton = document.getElementById('nextToMatching');
    if (nextButton && foundWordsCount === totalWords) {
        nextButton.classList.remove('hidden');
        nextButton.classList.add('animate-bounce');
        setTimeout(() => nextButton.classList.remove('animate-bounce'), 1200);
        showNotification('🎉 ค้นพบครบทุกคำแล้ว! พร้อมไปจับคู่คำศัพท์', 'success');
    }
}

// Show Matching Game
async function showMatchingGame() {
    await renderStep(2.5); // New step for matching game
}

// Show User Menu
function showUserMenu() {
    const modal = document.createElement('div');
    modal.id = 'userMenuModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

    modal.innerHTML = `
        <div class="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full animate-bounce-in">
            <div class="text-center mb-6">
                <div class="text-4xl mb-4">👤</div>
                <h2 class="text-xl md:text-2xl font-bold text-gray-900 mb-2">ข้อมูลผู้ใช้</h2>
                <p class="text-gray-600">${gameState.currentUser?.name || 'ผู้ใช้'}</p>
                ${gameState.currentUser?.studentId ? `<p class="text-sm text-gray-500">${gameState.currentUser.grade}/${gameState.currentUser.room} เลขที่ ${gameState.currentUser.number}</p>` : ''}
            </div>

            <div class="space-y-4">
                <div class="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 p-4 rounded-xl">
                    <div class="grid grid-cols-2 gap-4 text-center">
                        <div>
                            <div class="text-2xl font-bold text-blue-600">${playerProfile.exp}</div>
                            <div class="text-sm text-gray-600">คะแนนรวม</div>
                        </div>
                        <div>
                            <div class="text-xl font-bold text-purple-600">${playerProfile.rank}</div>
                            <div class="text-sm text-gray-600">อันดับ</div>
                        </div>
                    </div>
                </div>

                <div class="flex gap-3">
                    <button onclick="userMenuGoHome()" class="flex-1 modern-button px-4 py-3 rounded-xl bg-blue-500 hover:bg-blue-600">
                        🏠 หน้าหลัก
                    </button>
                    <button onclick="userMenuSignOut()" class="flex-1 modern-button px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600">
                        🚪 ออกจากระบบ
                    </button>
                </div>

                <button onclick="closeUserMenu()" class="w-full bg-gray-500 hover:bg-gray-600 text-white px-4 py-3 rounded-xl font-semibold transition-all duration-200">
                    ปิด
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    incrementModalCount();
}

// Close User Menu
function closeUserMenu() {
    const modal = document.getElementById('userMenuModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// User Menu Functions
async function userMenuGoHome() {
    closeUserMenu();
    await goToHome();
}

async function userMenuSignOut() {
    closeUserMenu();
    await signOutUser();
    showLandingPage();
}

// Evaluate Creative Writing with Real-time AI-like Scoring
function evaluateCreativeWriting(text, type) {
    const keywords = {
        imagination: [
            'ช้าง', 'สมเด็จพระสุริโยทัย', 'พระเจ้าแปร', 'ง้าว', 'สงคราม', 'รบ', 'ต่อสู้',
            'อก', 'เลือด', 'ตาย', 'กล้าหาญ', 'เสียสละ', 'ปกป้อง', 'พระราชสามี',
            'ศัตรู', 'พม่า', 'กรุงศรีอยุธยา', 'โอรส', 'พระศพ', 'ความรัก', 'ความภักดี',
            'นงคราญ', 'กระษัตรีย์', 'มาน', 'กัตเวที', 'มลาย', 'คเชนทร', 'ดัสกร', 'แล่ง', 'อุระ', 'หรุบ', 'พจน์'
        ],
        interpretation: [
            // Core semantic lexicon for interpretation evaluation
            'สมเด็จ', 'พระสุริโยทัย', 'เกรง', 'พระสวามี', 'พระราชสามี', 'สิ้นพระชนม์', 'ตาย', 'สวรรคต',
            'ขับ', 'ช้าง', 'คช', 'หัตถี', 'เข้า', 'ขวาง', 'พระเจ้าแปร', 'แปร', 'มอญ', 'พม่า', 'ต่อสู้', 'รบ',
            'ง้าว', 'ฟัน', 'ผ่า', 'อก', 'อุระ', 'ทรวง', 'บน', 'คอ', 'โอรส', 'พระราชโอรส', 'บุตร',
            'พระราเมศวร', 'มหินทรา', 'กัน', 'พระศพ', 'นำ', 'เมือง', 'นคร', 'สรรเสริญ', 'เยินยอ',
            'กล้าหาญ', 'เสียสละ', 'ปกป้อง', 'วีรกรรม', 'ความรัก', 'ความภักดี'
        ]
    };

    const relevantKeywords = keywords[type] || [];
    const textLower = text.toLowerCase();
    let score = 0;
    let foundKeywords = 0;
    let keywordDetails = [];

    // Advanced keyword matching with context
    relevantKeywords.forEach(keyword => {
        if (textLower.includes(keyword.toLowerCase())) {
            foundKeywords++;
            let points = 5;

            // Bonus points for important keywords
            if (['สมเด็จพระสุริโยทัย', 'พระเจ้าแปร', 'ง้าว', 'ช้าง'].includes(keyword)) {
                points = 8;
            }

            score += points;
            keywordDetails.push({ keyword, points });
        }
    });

    // Length and structure analysis
    const wordCount = text.trim().split(/\s+/).length;
    const sentences = text.split(/[.!?]/).filter(s => s.trim().length > 0).length;

    // Length scoring with better scaling
    if (wordCount >= 100) score += 30;
    else if (wordCount >= 80) score += 25;
    else if (wordCount >= 60) score += 20;
    else if (wordCount >= 40) score += 15;
    else if (wordCount >= 20) score += 10;
    else if (wordCount >= 10) score += 5;

    // Structure bonus
    if (sentences >= 3) score += 10;
    else if (sentences >= 2) score += 5;

    // Content quality analysis
    const qualityWords = [
        'สวยงาม', 'น่าเกรงขาม', 'ยิ่งใหญ่', 'น่าสงสาร', 'น่าชื่นชม', 'เศร้าโศก', 'ภาคภูมิใจ',
        'วีรกรรม', 'เสียสละ', 'กล้าหาญ', 'ความรัก', 'ความภักดี', 'น่าประทับใจ', 'สะเทือนใจ',
        'ความงาม', 'ความแกร่ง', 'ความเข้มแข็ง', 'ความอ่อนโยน', 'ความรุนแรง', 'ความเศร้าโศก'
    ];

    let qualityScore = 0;
    qualityWords.forEach(word => {
        if (textLower.includes(word.toLowerCase())) {
            qualityScore += 3;
        }
    });
    score += Math.min(qualityScore, 15); // Cap quality bonus

    // Creativity and originality bonus
    const creativeElements = [
        'เสียงดัง', 'แสงแวบ', 'ฝุ่นฟุ้ง', 'เลือดไหล', 'น้ำตา', 'เสียงร้อง',
        'ความมืด', 'แสงแดด', 'ลมแรง', 'ฟ้าร้อง', 'เมฆดำ', 'ดาวดวง'
    ];

    let creativityScore = 0;
    creativeElements.forEach(element => {
        if (textLower.includes(element.toLowerCase())) {
            creativityScore += 2;
        }
    });
    score += Math.min(creativityScore, 10); // Cap creativity bonus

    // Penalty for too short content
    if (wordCount < 10) {
        score = Math.max(0, score - 20);
    }

    // Final score calculation with realistic scaling
    const finalScore = Math.min(Math.max(score, 0), 100);

    return {
        score: finalScore,
        foundKeywords: foundKeywords,
        wordCount: wordCount,
        sentences: sentences,
        keywordDetails: keywordDetails,
        feedback: generateAdvancedFeedback(finalScore, foundKeywords, wordCount, sentences, type)
    };
}

function generateAdvancedFeedback(score, keywords, wordCount, sentences, type) {
    let feedback = '';
    let suggestions = [];

    // Score-based feedback
    if (score >= 90) {
        feedback = '🌟 เยี่ยมยอด! ';
    } else if (score >= 80) {
        feedback = '🎉 ยอดเยี่ยม! ';
    } else if (score >= 70) {
        feedback = '👍 ดีมาก! ';
    } else if (score >= 60) {
        feedback = '😊 ดี! ';
    } else if (score >= 50) {
        feedback = '👌 พอใช้! ';
    } else {
        feedback = '💪 ต้องปรับปรุง! ';
    }

    // Content analysis
    if (type === 'imagination') {
        feedback += `คุณใช้คำสำคัญ ${keywords} คำ เขียน ${wordCount} คำ ใน ${sentences} ประโยค `;

        if (keywords >= 8) {
            feedback += 'แสดงความเข้าใจเนื้อหาอย่างลึกซึ้ง ';
        } else if (keywords >= 5) {
            feedback += 'แสดงความเข้าใจเนื้อหาดี ';
            suggestions.push('ลองเพิ่มรายละเอียดเกี่ยวกับอารมณ์และความรู้สึก');
        } else if (keywords >= 3) {
            feedback += 'เข้าใจเนื้อหาพอสมควร ';
            suggestions.push('ลองเพิ่มคำศัพท์จากโคลงมากขึ้น');
        } else {
            suggestions.push('ควรใช้คำศัพท์จากโคลงให้มากขึ้น');
            suggestions.push('อธิบายตัวละครและเหตุการณ์ให้ชัดเจน');
        }

        if (wordCount < 30) {
            suggestions.push('ลองขยายความคิดให้ยาวขึ้น อธิบายภาพที่เห็นในใจให้ละเอียด');
        }

    } else { // interpretation
        feedback += `คุณใช้คำสำคัญ ${keywords} คำ เขียน ${wordCount} คำ ใน ${sentences} ประโยค `;

        if (keywords >= 10) {
            feedback += 'ถอดความได้ครบถ้วนและถูกต้อง ';
        } else if (keywords >= 7) {
            feedback += 'ถอดความได้ดี ';
            suggestions.push('ลองเพิ่มรายละเอียดเกี่ยวกับผลลัพธ์');
        } else if (keywords >= 5) {
            feedback += 'ถอดความได้พอสมควร ';
            suggestions.push('ลองเพิ่มเหตุการณ์สำคัญที่ยังขาด');
        } else {
            suggestions.push('ควรใช้คำศัพท์จากโคลงมากขึ้น');
            suggestions.push('อธิบายลำดับเหตุการณ์ให้ชัดเจน');
        }

        if (wordCount < 40) {
            suggestions.push('ลองขยายความให้ยาวขึ้น เล่าเหตุการณ์ให้ครบถ้วน');
        }
    }

    // Add suggestions to feedback
    if (suggestions.length > 0) {
        feedback += '\n💡 คำแนะนำ: ' + suggestions.join(' • ');
    }

    return feedback;
}

// Setup Step 3 Handlers
function setupStep3Handlers() {
    const imaginationInput = document.getElementById('imaginationInput');
    const interpretationInput = document.getElementById('interpretationInput');
    const nextBtn = document.getElementById('nextStep3');

    // Load saved data
    if (gameState.imaginationText) {
        imaginationInput.value = gameState.imaginationText;
    }
    if (gameState.interpretationText) {
        interpretationInput.value = gameState.interpretationText;
    }

    function updateButtonState() {
        const imaginationLength = imaginationInput.value.trim().length;
        const interpretationLength = interpretationInput.value.trim().length;

        nextBtn.disabled = imaginationLength < 10 || interpretationLength < 10;
    }

    // Initial button state check
    updateButtonState();

    imaginationInput.addEventListener('input', async () => {
        gameState.imaginationText = imaginationInput.value;
        updateButtonState();

        // ไม่ให้คะแนนจินตนาการแล้ว - เก็บข้อมูลเท่านั้น

        await saveCurrentGameState();
        await saveAllUserAnswers();
    });

    interpretationInput.addEventListener('input', async () => {
        gameState.interpretationText = interpretationInput.value;
        updateButtonState();

        // Real-time evaluation
        if (interpretationInput.value.trim().length > 20) {
            const evaluation = evaluateCreativeWriting(interpretationInput.value, 'interpretation');
            showWritingFeedback('interpretation', evaluation);
        }

        await saveCurrentGameState();
        await saveAllUserAnswers();
    });

    nextBtn.addEventListener('click', async () => {
        try {
            gameState.imaginationText = imaginationInput.value;
            gameState.interpretationText = interpretationInput.value;

            // Final evaluation - ไม่ให้คะแนนจินตนาการ
            const interpretationEval = evaluateCreativeWriting(gameState.interpretationText, 'interpretation');

            gameState.imaginationScore = 0; // ไม่ให้คะแนน
            gameState.interpretationScore = interpretationEval.score;

            await saveCurrentGameState();
            await saveAllUserAnswers();

            showNotification(`บันทึกเรียบร้อย! คะแนนถอดความ: ${interpretationEval.score}`, 'success');
            await renderStep(4);
        } catch (error) {
            console.error('Error saving step 3 data:', error);
            showNotification('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
        }
    });
}

function showWritingFeedback(type, evaluation) {
    const containerId = type === 'imagination' ? 'imaginationFeedback' : 'interpretationFeedback';
    let container = document.getElementById(containerId);

    if (!container) {
        const inputElement = document.getElementById(type === 'imagination' ? 'imaginationInput' : 'interpretationInput');
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'mt-3 p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 rounded-xl';
        inputElement.parentNode.appendChild(container);
    }

    // Determine color based on score
    let scoreColor = 'text-red-600';
    let barColor = 'bg-red-500';
    if (evaluation.score >= 80) {
        scoreColor = 'text-green-600';
        barColor = 'bg-green-500';
    } else if (evaluation.score >= 60) {
        scoreColor = 'text-blue-600';
        barColor = 'bg-blue-500';
    } else if (evaluation.score >= 40) {
        scoreColor = 'text-yellow-600';
        barColor = 'bg-yellow-500';
    }

    // Split feedback into main text and suggestions
    const feedbackParts = evaluation.feedback.split('\n💡 คำแนะนำ: ');
    const mainFeedback = feedbackParts[0];
    const suggestions = feedbackParts[1];

    container.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <span class="font-bold ${scoreColor} text-lg">คะแนน: ${evaluation.score}/100</span>
            <div class="w-32 h-3 bg-gray-200 rounded-full overflow-hidden">
                <div class="h-full ${barColor} rounded-full transition-all duration-500 ease-out" style="width: ${evaluation.score}%"></div>
            </div>
        </div>

        <div class="space-y-2">
            <p class="text-sm font-semibold text-blue-800">${mainFeedback}</p>

            ${evaluation.keywordDetails && evaluation.keywordDetails.length > 0 ? `
                <div class="text-xs text-gray-600 flex flex-wrap items-center gap-2 gap-y-1">
                    <span class="font-semibold">คำสำคัญที่พบ:</span>
                    ${evaluation.keywordDetails.map(kw => `<span class="bg-green-100 text-green-800 px-2 py-1 rounded-full">${kw.keyword} (+${kw.points})</span>`).join('')}
                </div>
            ` : ''}

            ${suggestions ? `
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-2">
                    <div class="flex items-start gap-2">
                        <span class="text-yellow-600 text-lg">💡</span>
                        <div class="text-xs text-yellow-800">
                            <span class="font-semibold">คำแนะนำ:</span><br>
                            ${suggestions.split(' • ').map(s => `• ${s}`).join('<br>')}
                        </div>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// Reveal Image Function with Dust Wiping Effect
function setupImageReveal() {
    const container = document.getElementById('imageContainer');
    const img = document.getElementById('historicalImage');
    const overlay = document.getElementById('imageOverlay');
    const canvas = document.getElementById('revealCanvas');

    if (!container || !img || !overlay || !canvas) return;

    const ctx = canvas.getContext('2d');
    let isRevealing = false;
    let revealProgress = 0;

    // Set canvas size
    function resizeCanvas() {
        const rect = img.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        // Create thicker dusty/foggy overlay effect (ทำให้หนาขึ้น)
        const gradient = ctx.createRadialGradient(
            canvas.width / 2, canvas.height / 2, 0,
            canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
        );
        gradient.addColorStop(0, 'rgba(160, 160, 160, 0.95)'); // เพิ่มความทึบ
        gradient.addColorStop(0.5, 'rgba(120, 120, 120, 0.9)'); // เพิ่มความทึบ
        gradient.addColorStop(1, 'rgba(80, 80, 80, 0.85)'); // เพิ่มความทึบ

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add more dust particles effect (เพิ่มฝุ่นให้มากขึ้น)
        for (let i = 0; i < 200; i++) { // เพิ่มจาก 100 เป็น 200
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = Math.random() * 4 + 1; // เพิ่มขนาดฝุ่น

            ctx.fillStyle = `rgba(140, 140, 140, ${Math.random() * 0.7 + 0.4})`; // เพิ่มความทึบ
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add extra dust layer (เพิ่มชั้นฝุ่นพิเศษ)
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const size = Math.random() * 8 + 3;

            ctx.fillStyle = `rgba(100, 100, 100, ${Math.random() * 0.4 + 0.2})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Initialize canvas
    img.onload = resizeCanvas;
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Update overlay text for dust wiping effect
    overlay.innerHTML = `
        <div class="text-white text-center">
            <div class="text-4xl mb-2 animate-bounce">🧹</div>
            <p class="text-lg font-bold">ปัดฝุ่นเพื่อเปิดเผยภาพ</p>
            <p class="text-sm mt-2 opacity-75">ลากเมาส์หรือนิ้วเพื่อเช็ดฝุ่น</p>
        </div>
    `;

    function startRevealing(e) {
        isRevealing = true;
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';
        reveal(e);

        // Change cursor to indicate wiping
        container.style.cursor = 'grab';
    }

    function reveal(e) {
        if (!isRevealing) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || e.touches[0].clientX) - rect.left;
        const y = (e.clientY || e.touches[0].clientY) - rect.top;

        // Create wiping effect with smaller brush (ทำให้ยากขึ้น)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, 25, 0, Math.PI * 2); // ลดขนาดจาก 40 เป็น 25
        ctx.fill();

        // Add wiping trail effect with smaller brush
        if (reveal.lastX !== undefined && reveal.lastY !== undefined) {
            ctx.lineWidth = 50; // ลดขนาดจาก 80 เป็น 50
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(reveal.lastX, reveal.lastY);
            ctx.lineTo(x, y);
            ctx.stroke();
        }

        reveal.lastX = x;
        reveal.lastY = y;

        // Check reveal progress every 30 strokes (เพิ่มจาก 20 เป็น 30)
        revealProgress += 1;
        if (revealProgress % 30 === 0) {
            // Check if enough area has been revealed
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            let transparentPixels = 0;

            for (let i = 3; i < pixels.length; i += 4) {
                if (pixels[i] < 128) { // Alpha channel less than 50%
                    transparentPixels++;
                }
            }

            const revealPercentage = (transparentPixels / (pixels.length / 4)) * 100;

            // เพิ่มเงื่อนไขให้ยากขึ้น - ต้องปัดให้ได้ 70% แทน 50%
            if (revealPercentage >= 70) {
                completeReveal();
            }
        }
    }

    function stopRevealing() {
        isRevealing = false;
        reveal.lastX = undefined;
        reveal.lastY = undefined;
        container.style.cursor = 'pointer';
    }

    function completeReveal() {
        img.classList.remove('blur-lg');
        overlay.style.opacity = '0';
        canvas.style.opacity = '0';

        setTimeout(() => {
            overlay.style.display = 'none';
            canvas.style.pointerEvents = 'none';
        }, 1000);

        showNotification('🖼️ ปัดฝุ่นเสร็จแล้ว! ภาพถูกเปิดเผย', 'success');
    }

    // Mouse events
    container.addEventListener('mousedown', startRevealing);
    container.addEventListener('mousemove', reveal);
    container.addEventListener('mouseup', stopRevealing);
    container.addEventListener('mouseleave', stopRevealing);

    // Touch events
    container.addEventListener('touchstart', (e) => {
        e.preventDefault();
        startRevealing(e);
    });
    container.addEventListener('touchmove', (e) => {
        e.preventDefault();
        reveal(e);
    });
    container.addEventListener('touchend', stopRevealing);

    // Click to complete reveal
    container.addEventListener('click', completeReveal);
}

// Setup Step 4 Handlers
function setupStep4Handlers() {
    // Check if user has completed step 3 (imagination and interpretation)
    const hasRequiredData = gameState.imaginationText && gameState.interpretationText && 
                          gameState.imaginationText.trim().length >= 10 && 
                          gameState.interpretationText.trim().length >= 10;

    if (!hasRequiredData) {
        // Disable image reveal if no step 3 data
        const imageContainer = document.getElementById('imageContainer');
        const overlay = document.getElementById('imageOverlay');

        if (imageContainer && overlay) {
            imageContainer.style.pointerEvents = 'none';
            overlay.innerHTML = `
                <div class="text-white text-center">
                    <div class="text-4xl mb-2">🔒</div>
                    <p class="text-lg font-bold">ต้องทำหน้าจินตนาการ & ถอดความก่อน</p>
                    <p class="text-sm mt-2 opacity-75">กลับไปขั้นถอดความและจินตนาการเพื่อกรอกข้อมูลให้ครบ</p>
                    <button onclick="goToStep(3)" class="mt-4 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl">
                        ไปหน้าจินตนาการ & ถอดความ
                    </button>
                </div>
            `;
        }

        showNotification('กรุณาทำหน้าจินตนาการ & ถอดความให้เสร็จก่อน', 'error');
        return;
    }

    const showComparisonButton = document.getElementById('showComparison');
    if (showComparisonButton) {
        showComparisonButton.addEventListener('click', () => {
            const comparisonSection = document.getElementById('comparisonSection');
            if (comparisonSection) {
                comparisonSection.classList.remove('hidden');
                comparisonSection.classList.add('animate-bounce-in');
            }

            showComparisonButton.style.display = 'none';
            showNotification('เปรียบเทียบความคิดของคุณกับข้อมูลจริง!', 'success');
        });
    } else {
        console.warn('Show comparison button missing for step 4');
    }

    const nextStepButton = document.getElementById('nextStep4');
    if (nextStepButton) {
        nextStepButton.addEventListener('click', async () => {
            await renderStep(5);
        });
    } else {
        console.warn('Next step button missing for step 4');
    }
}

// Get Word Emoji
function getWordEmoji(word) {
    const emojiMap = {
        'นงคราญ': '👸',
        'มาน': '💖',
        'กัตเวที': '🙏',
        'มลาย': '💀',
        'คเชนทร': '🐘',
        'ดัสกร': '⚔️',
        'แล่ง': '🔪',
        'อุระ': '👤',
        'หรุบ': '⬇️',
        'ไป่': '❌',
        'พจน์': '💬'
    };
    return emojiMap[word] || '📝';
}

// Get Word Image
function getWordImage(word) {
    const imageMap = {
        'นงคราญ': 'https://img2.pic.in.th/pic/Gemini_Generated_Image_obzx9bobzx9bobzx.png',
        'มาน': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_xvra5axvra5axvra.png',
        'กัตเวที': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_npiozbnpiozbnpioc4686b30823835e2.png',
        'มลาย': 'https://img2.pic.in.th/pic/Gemini_Generated_Image_5dg3t75dg3t75dg3084de5b3dbf1da5a.png',
        'คเชนทร': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_2w0xpa2w0xpa2w0x6d96eebaef1428c5.png',
        'ดัสกร': 'https://img2.pic.in.th/pic/Gemini_Generated_Image_m7s5sjm7s5sjm7s5.png',
        'ง้าว': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_wwh7v4wwh7v4wwh7.png',
        'แล่ง': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_nofldgnofldgnofl.png',
        'อุระ': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_1tpy7b1tpy7b1tpy.png',
        'หรุบ': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_n464d3n464d3n464.png',
        'ไป่': 'https://img2.pic.in.th/pic/Gemini_Generated_Image_jij2fajij2fajij2.png',
        'พจน์': 'https://img5.pic.in.th/file/secure-sv1/Gemini_Generated_Image_o6l06zo6l06zo6l0.png'
    };
    return imageMap[word] || '';
}

// Setup Quiz
function setupQuiz() {
    // Load saved quiz answers if available
    if (gameState.comprehensionAnswers && gameState.comprehensionAnswers.length > 0) {
        gameState.comprehensionAnswers.forEach((answer, index) => {
            const radio = document.querySelector(`input[name="question_${index}"][value="${answer}"]`);
            if (radio) {
                radio.checked = true;
            }
        });

        // Show score if already checked
        if (gameState.comprehensionScore !== undefined) {
            document.getElementById('quizScore').textContent = gameState.comprehensionScore;
            document.getElementById('checkAnswers').classList.add('hidden');
            document.getElementById('finishQuiz').classList.remove('hidden');
        }
    }
}

// Check Quiz Answers
function checkQuizAnswers() {
    const mission = MISSION_DATA.MISSION_01;
    let score = 0;
    const answers = [];

    mission.comprehensionQuestions.forEach((q, index) => {
        const selectedRadio = document.querySelector(`input[name="question_${index}"]:checked`);
        const resultDiv = document.getElementById(`result_${index}`);

        if (selectedRadio) {
            const selectedValue = parseInt(selectedRadio.value);
            answers.push(selectedValue);

            if (selectedValue === q.correct) {
                score++;
                resultDiv.innerHTML = '<div class="text-green-600 font-semibold">✅ ถูกต้อง!</div>';
                resultDiv.classList.remove('hidden');
                selectedRadio.parentElement.classList.add('bg-green-100', 'border-green-300');
            } else {
                resultDiv.innerHTML = `<div class="text-red-600 font-semibold">❌ ผิด! คำตอบที่ถูก: ${q.options[q.correct]}</div>`;
                resultDiv.classList.remove('hidden');
                selectedRadio.parentElement.classList.add('bg-red-100', 'border-red-300');

                // Highlight correct answer
                const correctRadio = document.querySelector(`input[name="question_${index}"][value="${q.correct}"]`);
                if (correctRadio) {
                    correctRadio.parentElement.classList.add('bg-green-100', 'border-green-300');
                }
            }
        } else {
            answers.push(-1);
            resultDiv.innerHTML = '<div class="text-orange-600 font-semibold">⚠️ ไม่ได้เลือกคำตอบ</div>';
            resultDiv.classList.remove('hidden');
        }
    });

    // Save answers and score
    gameState.comprehensionAnswers = answers;
    gameState.comprehensionScore = score;

    // Update UI
    document.getElementById('quizScore').textContent = score;
    document.getElementById('checkAnswers').classList.add('hidden');

    // Check if score is less than half
    const halfScore = Math.ceil(mission.comprehensionQuestions.length / 2);
    if (score < halfScore) {
        // Show retry button for low scores
        document.getElementById('retryQuiz').classList.remove('hidden');
        showNotification(`คะแนน: ${score}/${mission.comprehensionQuestions.length} ข้อ - คะแนนต่ำกว่าครึ่ง กรุณาทำใหม่หรือย้อนกลับไปทบทวน`, 'error');
    } else {
        // Show finish button for good scores
        document.getElementById('finishQuiz').classList.remove('hidden');
        showNotification(`คะแนน: ${score}/${mission.comprehensionQuestions.length} ข้อ - ผ่านเกณฑ์!`, 'success');
    }

    // Disable all radio buttons
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.disabled = true;
    });

    // Save to database
    saveCurrentGameState();
    saveAllUserAnswers();
}

// Retry Quiz
function retryQuiz() {
    // Clear all selections and results
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.checked = false;
        radio.disabled = false;
        radio.parentElement.classList.remove('bg-green-100', 'border-green-300', 'bg-red-100', 'border-red-300');
    });

    // Hide all result divs
    document.querySelectorAll('[id^="result_"]').forEach(resultDiv => {
        resultDiv.classList.add('hidden');
        resultDiv.innerHTML = '';
    });

    // Reset UI buttons
    document.getElementById('checkAnswers').classList.remove('hidden');
    document.getElementById('retryQuiz').classList.add('hidden');
    document.getElementById('finishQuiz').classList.add('hidden');

    // Reset score display
    document.getElementById('quizScore').textContent = '0';

    // Clear saved answers
    gameState.comprehensionAnswers = [];
    gameState.comprehensionScore = 0;

    showNotification('เริ่มทำแบบทดสอบใหม่!', 'success');
}

// Finish Quiz
async function finishQuiz() {
    await renderStep(6);
}

// Setup Matching Game
function setupMatchingGame() {
    let selectedWord = null;
    let matchedPairs = 0;
    let score = 0;
    const mission = MISSION_DATA.MISSION_01;
    const totalPairs = Object.keys(mission.hardWords).length;
    const scoreDisplay = document.getElementById('matchingScore');
    const finishBtn = document.getElementById('finishMatching');
    const resetBtn = document.getElementById('resetMatching');

    if (!scoreDisplay || !finishBtn || !resetBtn) {
        console.warn('Matching game elements missing; skipping setup.');
        return;
    }

    // Load saved matching state if available
    if (gameState.matchingScore !== undefined) {
        score = gameState.matchingScore;
        matchedPairs = gameState.matchedPairs || 0;
        updateMatchingScore();
    }

    function updateMatchingScore() {
        if (scoreDisplay) {
            scoreDisplay.textContent = score;
        }

        // Enable finish button when all pairs are matched
        if (matchedPairs >= totalPairs) {
            finishBtn.disabled = false;
            finishBtn.textContent = '➡️ ไปขั้นตอนถัดไป';
            showNotification('🎉 จับคู่ครบทุกคำแล้ว!', 'success');
        }
    }

    // Word click handler
    document.querySelectorAll('.word-item').forEach(wordEl => {
        wordEl.addEventListener('click', () => {
            // Remove previous selection
            document.querySelectorAll('.word-item').forEach(el => {
                el.classList.remove('bg-purple-200', 'border-purple-500');
            });

            // Select current word
            wordEl.classList.add('bg-purple-200', 'border-purple-500');
            selectedWord = wordEl.dataset.word;
        });
    });

    // Meaning click handler
    document.querySelectorAll('.meaning-item').forEach(meaningEl => {
        meaningEl.addEventListener('click', () => {
            if (!selectedWord) {
                showNotification('กรุณาเลือกคำศัพท์ก่อน', 'error');
                return;
            }

            const correctWord = meaningEl.dataset.word;

            if (selectedWord === correctWord) {
                // Correct match
                const wordEl = document.querySelector(`[data-word="${selectedWord}"]`);

                // Update UI for correct match
                meaningEl.classList.remove('border-dashed', 'border-green-300');
                meaningEl.classList.add('bg-green-200', 'border-green-500', 'border-solid');
                meaningEl.innerHTML = `
                    <div class="flex flex-col items-center justify-center gap-2">
                        <img src="${getWordImage(selectedWord)}" alt="${selectedWord}" class="w-16 h-16 md:w-20 md:h-20 rounded-lg border-2 border-green-600 object-cover shadow-md">
                        <span class="font-bold text-green-800 text-lg">${selectedWord}</span>
                        <span class="text-green-700 text-sm">${mission.hardWords[selectedWord].meaning}</span>
                    </div>
                `;

                // Remove word from left column
                wordEl.style.opacity = '0.3';
                wordEl.style.pointerEvents = 'none';
                wordEl.classList.remove('bg-gradient-to-r', 'from-red-400', 'to-red-500', 'hover:from-red-500', 'hover:to-red-600');
                wordEl.classList.add('bg-gray-400', 'text-gray-600');

                matchedPairs++;
                score += mission.hardWords[selectedWord].points;

                // Save progress
                gameState.matchingScore = score;
                gameState.matchedPairs = matchedPairs;
                saveCurrentGameState();

                showNotification(`✅ ถูกต้อง! +${mission.hardWords[selectedWord].points} คะแนน`, 'success');
                updateMatchingScore();

            } else {
                // Incorrect match
                meaningEl.classList.add('bg-red-100', 'border-red-400');
                setTimeout(() => {
                    meaningEl.classList.remove('bg-red-100', 'border-red-400');
                }, 1000);

                showNotification('❌ ไม่ถูกต้อง ลองใหม่อีกครั้ง', 'error');
            }

            // Clear selection
            selectedWord = null;
            document.querySelectorAll('.word-item').forEach(el => {
                el.classList.remove('bg-purple-200', 'border-purple-500');
            });
        });
    });

    // Drag and drop handlers
    document.querySelectorAll('.word-item').forEach(wordEl => {
        wordEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', wordEl.dataset.word);
            wordEl.classList.add('opacity-50');
        });

        wordEl.addEventListener('dragend', () => {
            wordEl.classList.remove('opacity-50');
        });
    });

    document.querySelectorAll('.meaning-item').forEach(meaningEl => {
        meaningEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            meaningEl.classList.add('bg-green-100', 'border-green-400');
        });

        meaningEl.addEventListener('dragleave', () => {
            meaningEl.classList.remove('bg-green-100', 'border-green-400');
        });

        meaningEl.addEventListener('drop', (e) => {
            e.preventDefault();
            meaningEl.classList.remove('bg-green-100', 'border-green-400');

            const draggedWord = e.dataTransfer.getData('text/plain');
            const correctWord = meaningEl.dataset.word;

            if (draggedWord === correctWord) {
                // Same logic as click handler for correct match
                const wordEl = document.querySelector(`[data-word="${draggedWord}"]`);

                meaningEl.classList.remove('border-dashed', 'border-green-300');
                meaningEl.classList.add('bg-green-200', 'border-green-500', 'border-solid');
                meaningEl.innerHTML = `
                    <div class="flex flex-col items-center justify-center gap-2">
                        <img src="${getWordImage(draggedWord)}" alt="${draggedWord}" class="w-16 h-16 md:w-20 md:h-20 rounded-lg border-2 border-green-600 object-cover shadow-md">
                        <span class="font-bold text-green-800 text-lg">${draggedWord}</span>
                        <span class="text-green-700 text-sm">${mission.hardWords[draggedWord].meaning}</span>
                    </div>
                `;

                wordEl.style.opacity = '0.3';
                wordEl.style.pointerEvents = 'none';
                wordEl.classList.remove('bg-gradient-to-r', 'from-red-400', 'to-red-500', 'hover:from-red-500', 'hover:to-red-600');
                wordEl.classList.add('bg-gray-400', 'text-gray-600');

                matchedPairs++;
                score += mission.hardWords[draggedWord].points;

                gameState.matchingScore = score;
                gameState.matchedPairs = matchedPairs;
                saveCurrentGameState();

                showNotification(`✅ ถูกต้อง! +${mission.hardWords[draggedWord].points} คะแนน`, 'success');
                updateMatchingScore();

            } else {
                meaningEl.classList.add('bg-red-100', 'border-red-400');
                setTimeout(() => {
                    meaningEl.classList.remove('bg-red-100', 'border-red-400');
                }, 1000);

                showNotification('❌ ไม่ถูกต้อง ลองใหม่อีกครั้ง', 'error');
            }
        });
    });

    // Reset button
    resetBtn.addEventListener('click', () => {
        if (confirm('คุณต้องการเริ่มเกมจับคู่ใหม่หรือไม่?')) {
            location.reload(); // Simple reset by reloading
        }
    });

    // Finish button
    finishBtn.addEventListener('click', async () => {
        gameState.matchingScore = score;
        await saveCurrentGameState();
        await saveAllUserAnswers();

        showNotification('เสร็จสิ้นการจับคู่คำศัพท์!', 'success');
        await renderStep(3); // Go to next step
    });

    // Initial score update
    updateMatchingScore();
}

// Go to specific step
async function goToStep(step) {
    await renderStep(step);
}

// Update user name display
function updateUserNameDisplay() {
    const headerUserName = getElement('headerUserName');
    const currentUserName = getElement('currentUserName');
    const currentUserRank = getElement('currentUserRank');

    if (gameState.currentUser && headerUserName && currentUserName) {
        headerUserName.classList.remove('hidden');
        currentUserName.textContent = gameState.currentUser.name || 'ผู้ใช้';
        if (currentUserRank) {
            const rankLabel = playerProfile.rank || 'มือใหม่';
            currentUserRank.textContent = `ระดับ ${rankLabel}`;
        }
    } else if (headerUserName) {
        headerUserName.classList.add('hidden');
        if (currentUserRank) {
            currentUserRank.textContent = 'ระดับ มือใหม่';
        }
    }
}

// Certificate Generation
async function generateCertificate() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = 3508;
    canvas.height = 2480;

    ctx.fillStyle = '#fde2f3';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#f9a8d4';
    ctx.lineWidth = 18;
    ctx.strokeRect(90, 90, canvas.width - 180, canvas.height - 180);
    ctx.strokeStyle = '#fbcfe8';
    ctx.lineWidth = 6;
    ctx.strokeRect(140, 140, canvas.width - 280, canvas.height - 280);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#2f2f2f';

    const headerFont = 'bold 120px "Sarabun", "TH Sarabun New", "IBM Plex Sans Thai Looped", sans-serif';
    const subHeaderFont = 'bold 90px "Sarabun", "TH Sarabun New", "IBM Plex Sans Thai Looped", sans-serif';
    const bodyFont = '70px "Sarabun", "TH Sarabun New", "IBM Plex Sans Thai Looped", sans-serif';
    const emphasisFont = 'bold 80px "Sarabun", "TH Sarabun New", "IBM Plex Sans Thai Looped", sans-serif';

    ctx.font = headerFont;
    ctx.fillText('คณะครุศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย', canvas.width / 2, 520);

    ctx.font = subHeaderFont;
    ctx.fillText('เกียรติบัตร', canvas.width / 2, 680);

    ctx.font = bodyFont;
    ctx.fillText('มอบให้ไว้เพื่อแสดงว่า', canvas.width / 2, 820);

    const studentName = gameState.currentUser?.name || '..............................................';
    ctx.font = emphasisFont;
    ctx.fillText(studentName, canvas.width / 2, 950);

    ctx.font = bodyFont;
    ctx.fillText('ได้ผ่านการทดสอบกิจกรรม', canvas.width / 2, 1080);
    ctx.font = emphasisFont;
    ctx.fillText('“ไขรหัสวรรณคดี”', canvas.width / 2, 1160);

    ctx.font = bodyFont;
    const lines = [
        'โดยหลักสูตรและการสอน (การสอนภาษาไทย)',
        'คณะครุศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย',
        'เพื่อส่งเสริมความรู้ ความเข้าใจ และความรักในวรรณคดีไทย',
        'รวมทั้งพัฒนาทักษะการอ่าน วิเคราะห์ และตีความวรรณศิลป์อย่างสร้างสรรค์'
    ];
    lines.forEach((line, index) => {
        ctx.fillText(line, canvas.width / 2, 1290 + index * 80);
    });

    ctx.fillText('ขอให้รักษาความมุ่งมั่นและความเพียรพยายามนี้ไว้', canvas.width / 2, 1620);
    ctx.fillText('เพื่อก้าวสู่ความสำเร็จในการเรียนรู้ต่อไป', canvas.width / 2, 1700);

    const currentDate = new Date().toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    ctx.font = '60px "Sarabun", "TH Sarabun New", "IBM Plex Sans Thai Looped", sans-serif';
    ctx.fillText(`ลงวันที่ ${currentDate}`, canvas.width / 2, 1840);

    const signatureBaseline = 2240;
    const signatureSpacing = 70;
    ctx.font = bodyFont;
    ctx.fillText('ลงชื่อ .................................................................', canvas.width / 2, signatureBaseline);
    ctx.font = emphasisFont;
    ctx.fillText('(นายมงคล แก้วไทย)', canvas.width / 2, signatureBaseline + signatureSpacing);
    ctx.font = bodyFont;
    ctx.fillText('คณบดีคณะครุศาสตร์', canvas.width / 2, signatureBaseline + signatureSpacing * 2);
    ctx.fillText('จุฬาลงกรณ์มหาวิทยาลัย', canvas.width / 2, signatureBaseline + signatureSpacing * 3);

    return canvas;
}


// Play Again Function
async function playAgain() {
    let hasError = false;

    try {
        await saveAllUserAnswers();
    } catch (error) {
        hasError = true;
        console.error('Error saving answers before restart:', error);
    }

    try {
        if (gameState.gameId) {
            await clearGameSession(gameState.gameId);
        }
    } catch (error) {
        hasError = true;
        console.error('Error clearing previous game session:', error);
    }

    // Reset game state completely
    gameState.currentStep = 1;
    gameState.maxStepReached = 1;
    gameState.translatedWords = {};
    gameState.incorrectWords = {};
    gameState.wordAttempts = {};
    gameState.imaginationText = '';
    gameState.interpretationText = '';
    gameState.comprehensionScore = 0;
    gameState.startTime = Date.now();
    gameState.selectedWord = null;
    gameState.stepHistory = [];
    gameState.comprehensionAnswers = [];
    gameState.gameId = generateGameId();

    // Show landing page with start button
    showLandingPage();

    if (hasError) {
        showNotification('เริ่มเกมใหม่แล้ว (มีบางข้อมูลบันทึกไม่สำเร็จ)', 'error');
    } else {
        showNotification('พร้อมเล่นใหม่แล้ว! กดปุ่มเริ่มเกมเพื่อเริ่มต้น', 'success');
    }
}

// Show Certificate Modal
function showCertificate() {
    const modal = document.createElement('div');
    modal.id = 'certificateModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4';

    const studentName = gameState.currentUser?.name || 'ผู้เล่น';
    const studentDetails = gameState.currentUser?.studentId ? 
        `รหัสนักเรียน: ${gameState.currentUser.studentId} | ชั้น: ${gameState.currentUser.grade}/${gameState.currentUser.room} เลขที่: ${gameState.currentUser.number}` : 
        'ผู้เรียนออนไลน์';

    const currentDate = new Date().toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    modal.innerHTML = `
        <div class="modal-card scrollable certificate-modal bg-transparent p-4 md:p-6 max-w-5xl w-full animate-bounce-in relative">
            <button onclick="closeCertificateModal()" class="absolute top-4 right-4 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold transition-all duration-200 shadow-lg text-lg z-10">
                ×
            </button>

            <div class="certificate-sheet space-y-8">
                <div class="text-center space-y-2">
                    <p class="certificate-header-text">คณะครุศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย</p>
                    <h1 class="text-3xl md:text-5xl font-extrabold text-rose-700 tracking-wide">เกียรติบัตร</h1>
                </div>

                <div class="text-center space-y-3">
                    <p class="text-base md:text-lg text-slate-700">มอบให้ไว้เพื่อแสดงว่า</p>
                    <p class="text-2xl md:text-3xl font-semibold text-rose-700">${studentName}</p>
                    <p class="text-xs md:text-sm text-slate-500">${studentDetails}</p>
                </div>

                <div class="text-center text-sm md:text-base text-slate-700 leading-relaxed space-y-3">
                    <p>ได้ผ่านการทดสอบกิจกรรม “ไขรหัสวรรณคดี”</p>
                    <p>โดยหลักสูตรและการสอน (การสอนภาษาไทย) คณะครุศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย</p>
                    <p>เพื่อส่งเสริมความรู้ ความเข้าใจ และความรักในวรรณคดีไทย รวมทั้งพัฒนาทักษะการอ่าน วิเคราะห์ และตีความวรรณศิลป์อย่างสร้างสรรค์</p>
                    <p>ขอให้รักษาความมุ่งมั่นและความเพียรพยายามนี้ไว้ เพื่อก้าวสู่ความสำเร็จในการเรียนรู้ต่อไป</p>
                </div>

                <div class="text-center text-sm md:text-base text-slate-600">
                    <p>ลงวันที่ ${currentDate}</p>
                </div>

                <div class="certificate-signature-block text-center space-y-2">
                    <p class="text-sm md:text-base text-slate-600">ลงชื่อ .................................................................</p>
                    <p class="text-base md:text-lg font-semibold text-slate-800">(นายมงคล แก้วไทย)</p>
                    <p class="text-sm text-slate-600">คณบดีคณะครุศาสตร์ จุฬาลงกรณ์มหาวิทยาลัย</p>
                </div>
            </div>

            <div class="flex flex-col md:flex-row gap-4 mt-6 justify-center">
                <button onclick="downloadCertificateImage()" class="modern-button px-6 py-3 text-lg rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600">
                    💾 บันทึกเป็นรูปภาพ
                </button>
                <button onclick="closeCertificateModal()" class="modern-button px-6 py-3 text-lg rounded-2xl bg-gray-500 hover:bg-gray-600">
                    ปิด
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

// Close Certificate Modal
function closeCertificateModal() {
    const modal = document.getElementById('certificateModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Download Certificate as Image
async function downloadCertificateImage() {
    try {
        const canvas = await generateCertificate();

        // Convert to blob and download
        canvas.toBlob((blob) => {
            if (!blob) {
                showNotification('ไม่สามารถสร้างไฟล์ภาพได้', 'error');
                return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const studentName = gameState.currentUser?.name || 'ผู้เล่น';
            const studentId = gameState.currentUser?.studentId || 'unknown';
            const date = new Date().toLocaleDateString('th-TH').replace(/\//g, '-');

            a.download = `เกียรติบัตร_${studentName}_${studentId}_${date}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification('ดาวน์โหลดเกียรติบัตรเรียบร้อย! 🎉', 'success');
        }, 'image/png', 0.95);

    } catch (error) {
        console.error('Error generating certificate:', error);
        showNotification('เกิดข้อผิดพลาดในการสร้างเกียรติบัตร', 'error');
    }
}

// Calculate Final Score
async function computePlayerRanking(playerScore = 0) {
    let scores = [];

    if (Array.isArray(teacherDashboardState.rows) && teacherDashboardState.rows.length) {
        scores = teacherDashboardState.rows
            .map(row => Number(row.totalScore) || 0)
            .filter(score => Number.isFinite(score) && score > 0);
    }

    if (!scores.length) {
        try {
            const { sessions } = await fetchTeacherData();
            if (Array.isArray(sessions) && sessions.length) {
                scores = sessions
                    .map(session => Number(session.totalScore) || Number(session.comprehensionScore) || 0)
                    .filter(score => Number.isFinite(score) && score > 0);
            }
        } catch (error) {
            console.warn('ไม่สามารถดึงข้อมูลอันดับจากฐานข้อมูลได้', error);
        }
    }

    if (!scores.length) {
        const localSessions = loadLocalSessions();
        scores = localSessions
            .map(session => Number(session.totalScore) || Number(session.comprehensionScore) || 0)
            .filter(score => Number.isFinite(score) && score > 0);
    }

    const normalizedScore = Number(playerScore) || 0;

    if (!scores.some(score => Math.abs(score - normalizedScore) < 0.5)) {
        scores.push(normalizedScore);
    } else if (!scores.length) {
        scores = [normalizedScore];
    }

    scores = scores.filter(score => Number.isFinite(score));

    if (!scores.length) {
        return { position: 1, total: 1 };
    }

    scores.sort((a, b) => b - a);
    const position = scores.findIndex(score => normalizedScore >= score - 0.0001) + 1;

    return {
        position: position > 0 ? position : 1,
        total: scores.length
    };
}

async function calculateFinalScore() {
    try {
        const mission = MISSION_DATA.MISSION_01;
        let vocabularyScore = 0;

        // Calculate vocabulary points
        Object.values(gameState.translatedWords).forEach(word => {
            vocabularyScore += word.points;
        });

        // Comprehension bonus
        const comprehensionScore = gameState.comprehensionScore * 20;

        // Time bonus (max 50 points, decreases over time)
        const timeElapsed = (Date.now() - gameState.startTime) / 1000 / 60; // minutes
        const timeBonus = Math.max(0, Math.floor(50 - timeElapsed * 2));

        const total = vocabularyScore + comprehensionScore + timeBonus;

        // Update player profile
        playerProfile.exp += total;
        playerProfile.totalGamesPlayed += 1;
        if (total > playerProfile.bestScore) {
            playerProfile.bestScore = total;
        }

        // Save updated player profile
        await saveUserDataAsync();

        // Save final game completion data
        await saveAllUserAnswers();

        const finalScore = {
            vocabulary: vocabularyScore,
            comprehension: comprehensionScore,
            timeBonus: timeBonus,
            total: total
        };

        return finalScore;

    } catch (error) {
        console.error('Error calculating final score:', error);
        return {
            vocabulary: 0,
            comprehension: 0,
            timeBonus: 0,
            total: 0
        };
    }
}



// Handle iframe load
function handleIframeLoad() {
    const iframe = document.getElementById('dictionaryIframe');
    const fallback = document.getElementById('dictionaryFallback');

    if (iframe && fallback) {
        try {
            // Try to access iframe content to check if it loaded properly
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (iframeDoc && iframeDoc.body && iframeDoc.body.innerHTML.trim() !== '') {
                // iframe loaded successfully, hide fallback
                fallback.style.display = 'none';
                iframe.style.display = 'block';
            } else {
                // iframe didn't load properly, show fallback
                showDictionaryFallback();
            }
        } catch (e) {
            // Cross-origin error means the site is blocking iframe
            showDictionaryFallback();
        }
    }
}

// Show dictionary fallback
function showDictionaryFallback() {
    const iframe = document.getElementById('dictionaryIframe');
    const fallback = document.getElementById('dictionaryFallback');

    if (iframe && fallback) {
        iframe.style.display = 'none';
        fallback.style.display = 'flex';
    }
}

// Auto-detect iframe blocking after 3 seconds
setTimeout(() => {
    const iframe = document.getElementById('dictionaryIframe');
    if (iframe) {
        try {
            // Try to access iframe content
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc || !iframeDoc.body || iframeDoc.body.innerHTML.trim() === '') {
                showDictionaryFallback();
            }
        } catch (e) {
            showDictionaryFallback();
        }
    }
}, 3000);

// Open Dictionary in New Tab
function openDictionaryNewTab() {
    window.open('https://dictionary.orst.go.th/index.php', '_blank', 'noopener,noreferrer');
    showNotification('เปิดพจนานุกรมในแท็บใหม่แล้ว! 📖', 'success');
}

// Show Quick Search Modal
function showQuickSearch() {
    const modal = document.createElement('div');
    modal.id = 'quickSearchModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

    modal.innerHTML = `
        <div class="bg-white rounded-3xl p-6 max-w-2xl w-full animate-bounce-in relative">
            <button onclick="closeQuickSearchModal()" class="absolute top-4 right-4 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold">×</button>

            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">🔍 ค้นหาด่วน</h2>
                <p class="text-gray-600">ค้นหาความหมายคำศัพท์จากแหล่งต่างๆ</p>
            </div>

            <div class="mb-6">
                <input type="text" id="quickSearchInput" class="w-full modern-input p-4 text-lg" placeholder="พิมพ์คำที่ต้องการค้นหา..." autofocus>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button onclick="searchInDictionary()" class="bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-3">
                    <span class="text-2xl">📖</span>
                    <div class="text-left">
                        <div class="font-bold">พจนานุกรมราชบัณฑิตยสถาน</div>
                        <div class="text-sm opacity-90">ค้นหาในพจนานุกรมอย่างเป็นทางการ</div>
                    </div>
                </button>

                <button onclick="searchInGoogle()" class="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-3">
                    <span class="text-2xl">🔍</span>
                    <div class="text-left">
                        <div class="font-bold">Google Search</div>
                        <div class="text-sm opacity-90">ค้นหาความหมายใน Google</div>
                    </div>
                </button>

                <button onclick="searchInWikipedia()" class="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-3">
                    <span class="text-2xl">🌐</span>
                    <div class="text-left">
                        <div class="font-bold">วิกิพีเดีย</div>
                        <div class="text-sm opacity-90">ค้นหาในสารานุกรมออนไลน์</div>
                    </div>
                </button>

                <button onclick="searchInSanook()" class="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-3">
                    <span class="text-2xl">📚</span>
                    <div class="text-left">
                        <div class="font-bold">พจนานุกรมสนุก</div>
                        <div class="text-sm opacity-90">ค้นหาในพจนานุกรมออนไลน์</div>
                    </div>
                </button>
            </div>

            <div class="mt-6 text-center">
                <button onclick="closeQuickSearchModal()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200">
                    ปิด
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add enter key listener
    const quickSearchInput = getElement('quickSearchInput');
    if (quickSearchInput) {
        quickSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchInDictionary();
            }
        });
    }
}

// Close Quick Search Modal
function closeQuickSearchModal() {
    const modal = getElement('quickSearchModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Search functions
function searchInDictionary() {
    const input = getElement('quickSearchInput');
    const searchTerm = input ? input.value.trim() : '';
    if (searchTerm) {
        window.open(`https://dictionary.orst.go.th/search.php?search=${encodeURIComponent(searchTerm)}`, '_blank', 'noopener,noreferrer');
        closeQuickSearchModal();
        showNotification(`ค้นหา "${searchTerm}" ในพจนานุกรมราชบัณฑิตยสถาน`, 'success');
    } else {
        showNotification('กรุณาพิมพ์คำที่ต้องการค้นหา', 'error');
    }
}

function searchInGoogle() {
    const input = getElement('quickSearchInput');
    const searchTerm = input ? input.value.trim() : '';
    if (searchTerm) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(searchTerm + ' ความหมาย')}`, '_blank', 'noopener,noreferrer');
        closeQuickSearchModal();
        showNotification(`ค้นหา "${searchTerm}" ใน Google`, 'success');
    } else {
        showNotification('กรุณาพิมพ์คำที่ต้องการค้นหา', 'error');
    }
}

function searchInWikipedia() {
    const input = getElement('quickSearchInput');
    const searchTerm = input ? input.value.trim() : '';
    if (searchTerm) {
        window.open(`https://th.wikipedia.org/wiki/${encodeURIComponent(searchTerm)}`, '_blank', 'noopener,noreferrer');
        closeQuickSearchModal();
        showNotification(`ค้นหา "${searchTerm}" ในวิกิพีเดีย`, 'success');
    } else {
        showNotification('กรุณาพิมพ์คำที่ต้องการค้นหา', 'error');
    }
}

function searchInSanook() {
    const input = getElement('quickSearchInput');
    const searchTerm = input ? input.value.trim() : '';
    if (searchTerm) {
        window.open(`https://www.sanook.com/dict/search/${encodeURIComponent(searchTerm)}`, '_blank', 'noopener,noreferrer');
        closeQuickSearchModal();
        showNotification(`ค้นหา "${searchTerm}" ในพจนานุกรมสนุก`, 'success');
    } else {
        showNotification('กรุณาพิมพ์คำที่ต้องการค้นหา', 'error');
    }
}

// Show Alternative Dictionaries
function showAlternativeDictionaries() {
    const modal = document.createElement('div');
    modal.id = 'alternativeDictionariesModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

    modal.innerHTML = `
        <div class="bg-white rounded-3xl p-6 max-w-2xl w-full animate-bounce-in relative">
            <button onclick="closeAlternativeDictionariesModal()" class="absolute top-4 right-4 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold">×</button>

            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">📚 พจนานุกรมและแหล่งข้อมูล</h2>
                <p class="text-gray-600">เลือกแหล่งข้อมูลที่ต้องการใช้ค้นหาความหมายคำศัพท์</p>
            </div>

            <div class="space-y-4">
                <button onclick="openLink('https://dictionary.orst.go.th/')" class="w-full bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-4">
                    <span class="text-2xl">📖</span>
                    <div class="text-left">
                        <div class="font-bold">พจนานุกรมราชบัณฑิตยสถาน</div>
                        <div class="text-sm opacity-90">พจนานุกรมภาษาไทยอย่างเป็นทางการ</div>
                    </div>
                </button>

                <button onclick="openLink('https://th.wikipedia.org/')" class="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-4">
                    <span class="text-2xl">🌐</span>
                    <div class="text-left">
                        <div class="font-bold">วิกิพีเดียภาษาไทย</div>
                        <div class="text-sm opacity-90">สารานุกรมออนไลน์</div>
                    </div>
                </button>

                <button onclick="openLink('https://www.google.com/search?q=')" class="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-4">
                    <span class="text-2xl">🔍</span>
                    <div class="text-left">
                        <div class="font-bold">Google Search</div>
                        <div class="text-sm opacity-90">ค้นหาข้อมูลทั่วไป</div>
                    </div>
                </button>

                <button onclick="openLink('https://www.sanook.com/dict/')" class="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center gap-4">
                    <span class="text-2xl">📚</span>
                    <div class="text-left">
                        <div class="font-bold">พจนานุกรมสนุก</div>
                        <div class="text-sm opacity-90">พจนานุกรมออนไลน์</div>
                    </div>
                </button>
            </div>

            <div class="mt-6 text-center">
                <button onclick="closeAlternativeDictionariesModal()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200">
                    ปิด
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    incrementModalCount();
}

// Close Alternative Dictionaries Modal
function closeAlternativeDictionariesModal() {
    const modal = document.getElementById('alternativeDictionariesModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Open Link in New Tab
function openLink(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    closeAlternativeDictionariesModal();
    showNotification('เปิดลิงก์ในแท็บใหม่แล้ว! 🔗', 'success');
}

// Show Word Hints
function showWordHints() {
    const modal = document.createElement('div');
    modal.id = 'wordHintsModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

    const mission = MISSION_DATA.MISSION_01;
    const wordsArray = Object.entries(mission.hardWords);

    modal.innerHTML = `
        <div class="modal-card scrollable bg-white rounded-3xl p-6 max-w-4xl w-full animate-bounce-in relative">
            <button onclick="closeWordHintsModal()" class="absolute top-4 right-4 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold">×</button>

            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">💡 ใบ้คำศัพท์</h2>
                <p class="text-gray-600">ดูภาพใบ้เพื่อช่วยในการค้นหาความหมาย</p>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                ${wordsArray.map(([word, data]) => `
                    <div class="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200 p-4 rounded-xl text-center hover:shadow-lg transition-all duration-200">
                        <img src="${getWordImage(word)}" alt="ใบ้สำหรับ ${word}" class="w-20 h-20 mx-auto rounded-lg border-2 border-blue-300 object-cover mb-3 shadow-md">
                        <div class="font-bold text-blue-900 text-lg mb-1">${word}</div>
                        <div class="text-xs text-blue-700">${data.points} คะแนน</div>
                        <div class="text-xs text-gray-600 mt-2">คลิกคำในโคลงเพื่อตอบ</div>
                    </div>
                `).join('')}
            </div>

            <div class="mt-6 text-center">
                <button onclick="closeWordHintsModal()" class="bg-gray-500 hover:bg-gray-600 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200">
                    ปิด
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    incrementModalCount();
}

// Close Word Hints Modal
function closeWordHintsModal() {
    const modal = document.getElementById('wordHintsModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Open Dictionary (Legacy function - now redirects to new tab)
function openDictionary() {
    openDictionaryNewTab();
}

// Close Dictionary Modal
function closeDictionaryModal() {
    const modal = document.getElementById('dictionaryModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Show Kloang Info
function showKloangInfo() {
    const modal = document.createElement('div');
    modal.id = 'kloangModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';

    modal.innerHTML = `
        <div class="modal-card scrollable bg-white rounded-3xl p-6 max-w-4xl w-full animate-bounce-in relative">
            <button onclick="closeKloangModal()" class="absolute top-4 right-4 w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center font-bold">×</button>

            <div class="text-center mb-6">
                <h2 class="text-2xl font-bold text-gray-900 mb-4">📋 ฉันทลักษณ์โคลงสี่สุภาพ</h2>
            </div>

            <div class="space-y-6">
                <div class="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200 p-6 rounded-xl">
                    <h3 class="text-xl font-bold text-blue-900 mb-4">คณะ</h3>
                    <div class="space-y-2 text-blue-800">
                        <p>• โคลงสี่สุภาพ 1 บทมี 4 บาท โดย 1 บรรทัดคือ 1 บาท แต่ละบาทมี 2 วรรค</p>
                        <p>• บาทที่ 1 บาทที่ 2 และบาทที่ 3 มีจำนวนคำเท่ากัน คือ วรรคหน้ามี 5 คำ ส่วนวรรคหลังมี 2 คำ</p>
                        <p>• บาทที่ 4 วรรคหน้ามี 5 คำเช่นกัน แต่วรรคหลังจะมี 4 คำ</p>
                        <p>• รวมทั้งสิ้น 1 บทจะมี 30 คำ</p>
                    </div>
                </div>

                <div class="bg-gradient-to-r from-orange-50 to-red-50 border-2 border-orange-200 p-6 rounded-xl">
                    <h3 class="text-xl font-bold text-orange-900 mb-4 text-center">รูปฉันทลักษณ์โคลงสี่สุภาพ</h3>
                    <div class="text-center">
                        <img src="https://img5.pic.in.th/file/secure-sv1/Screenshot-2025-10-19-234603.png" alt="รูปฉันทลักษณ์โคลงสี่สุภาพ" class="w-full max-w-3xl mx-auto rounded-xl border-2 border-orange-300 shadow-lg" onerror="this.src=''; this.alt='ไม่สามารถโหลดภาพได้'; this.style.display='none';">
                        <p class="text-orange-700 text-sm mt-3">รูปแบบฉันทลักษณ์โคลงสี่สุภาพ แสดงตำแหน่งวรรณยุกต์เอก (สีส้ม) โท (สีเขียว) และตำแหน่งอิสระ (ไม่นิยมใส่วรรณยุกต์)</p>
                    </div>
                </div>
            </div>

            <div class="text-center mt-6">
                <button onclick="closeKloangModal()" class="modern-button px-6 py-3 rounded-xl bg-gray-500 hover:bg-gray-600">ปิด</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    incrementModalCount();
}



// Close Kloang Modal
function closeKloangModal() {
    const modal = document.getElementById('kloangModal');
    if (modal) {
        modal.remove();
        decrementModalCount();
    }
}

// Close Tooltip
function closeTooltip() {
    const tooltip = document.getElementById('wordTooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// Show Notification
function showNotification(message, type = 'success') {
    const container = document.getElementById('notificationContainer');
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 4000);
}

window.addEventListener('error', (event) => {
    console.error('Global error captured:', event.error || event.message);
    if (event.error && event.error.silent) return;
    showNotification('เกิดข้อผิดพลาดที่ไม่คาดคิดในระบบ', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    if (event.reason && event.reason.silent) return;
    showNotification('ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง', 'error');
});

