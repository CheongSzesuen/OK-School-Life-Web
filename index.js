// 游戏数据 URL（用于加载 JSON 文件）
const GAME_DATA_URL = 'data/events.json';

const gameState = {
    currentApi: 'choose_start',
    lastResult: "",
    allAchievements: new Set(),
    userState: {
        school: null,
        familyIndex: null, // 保存初始选择（"1", "2" 或 "3"）
        eventIdx: 0,
        stage: "fixed",
        randomUsed: new Set(),
        lastRandomIdx: null
    },
    achievements: [],
    score: 0,
    eventData: null,
    version: "v0.4.0"
};

// 缓存常用 DOM 元素
const resultDiv = document.getElementById('result');
const messageDiv = document.getElementById('message');
const optionsDiv = document.getElementById('options');
const bottomOptionsDiv = document.getElementById('bottom-options');
const achievementsDiv = document.getElementById('achievements');
const achievementsListDiv = document.getElementById('achievements-list');
const coverImg = document.getElementById('cover-img');

// 辅助函数：贡献者显示
const getContributorStr = event => 
    event.contributors && event.contributors.length ? `（贡献者：${event.contributors.join("、")}）` : "";

// 辅助函数：返回事件结果（支持概率、数组和字符串格式）
function pickResult(resultValue) {
    if (Array.isArray(resultValue)) {
        const probs = resultValue.map(item => item.prob || 1 / resultValue.length);
        const chosen = weightedRandom(resultValue, probs);
        return { text: chosen.rd_result || chosen.text || "", endGame: Boolean(chosen.end_game) };
    }
    return { text: resultValue, endGame: false };
}

function weightedRandom(items, weights) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let rand = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
        rand -= weights[i];
        if (rand <= 0) return items[i];
    }
    return items[items.length - 1];
}

// 根据 JSON 数据获取各类事件数据
const getEventList = () => gameState.eventData?.metadata?.start_options || [];
const getGroupEvents = groupKey => gameState.eventData?.events?.fixed_events?.[groupKey] || [];
const getRandomEvents = () => gameState.eventData?.events?.random_events || [];

// ----- 逻辑接口函数：纯 JS 实现，并直接返回数据对象 -----

// 开始游戏：返回欢迎消息和主菜单
function startGame() {
    return {
        message: `欢迎来到OK School Life beta ${gameState.version}！\n你将经历不同的事件和选择，看看你的学校生活会如何发展。`,
        options: [
            { key: '1', text: '开始游戏' },
            { key: '2', text: '查看成就' },
            { key: '3', text: '清除数据' },
            { key: '4', text: '关于' },
            { key: '5', text: '退出' }
        ]
    };
}

// 用户选择初始家庭类型
function chooseStart(choice) {
    if (choice === '5') {
        return { message: '感谢游玩，期待下次再见！', game_over: true };
    }
    gameState.userState = {
        familyIndex: choice,
        school: null,
        eventIdx: 0,
        stage: "fixed",
        randomUsed: new Set(),
        lastRandomIdx: null
    };
    const familyOption = getEventList()[parseInt(choice) - 1];
    const groupKey = `group_${choice}`;
    const events = getGroupEvents(groupKey);
    if (!events.length) return { message: '未知事件', game_over: true };
    const firstEvent = events[0];
    return {
        message: `${familyOption}。\n${firstEvent.question}${getContributorStr(firstEvent)}`,
        options: Object.entries(firstEvent.choices).map(([key, text]) => ({ key, text })),
        next_event: 'fixed_event'
    };
}

// 处理固定事件选择
function fixedEvent(choice) {
    const groupKey = `group_${gameState.userState.familyIndex}`;
    const events = getGroupEvents(groupKey);
    if (!events.length) return { message: '未知事件', game_over: true };

    const currentEvent = events[gameState.userState.eventIdx];
    const res = pickResult(currentEvent.results[choice]);
    const triggeredAchievements = [];
    if (currentEvent.achievements?.[choice]) {
        const ach = currentEvent.achievements[choice];
        triggeredAchievements.push(ach);
        if (!gameState.achievements.includes(ach)) {
            gameState.achievements.push(ach);
        }
    }
    if (res.endGame || (currentEvent.end_game_choices && currentEvent.end_game_choices.includes(choice))) {
        return { message: `${res.text}\n你失败了，游戏结束！`, game_over: true, achievements: triggeredAchievements };
    }
    gameState.userState.eventIdx += 1;
    gameState.score += 1;
    if (gameState.userState.eventIdx < events.length) {
        const nextEvent = events[gameState.userState.eventIdx];
        return { 
            message: `${res.text}\n${nextEvent.question}${getContributorStr(nextEvent)}`, 
            options: Object.entries(nextEvent.choices).map(([key, text]) => ({ key, text })), 
            next_event: 'fixed_event',
            achievements: triggeredAchievements 
        };
    } 
    gameState.userState.stage = "random";
    return newRandomEvent(res.text, triggeredAchievements);
}

// 处理随机事件选择
function randomEvent(choice) {
    const randomEvents = getRandomEvents();
    const lastIdx = gameState.userState.lastRandomIdx;
    if (choice === undefined || lastIdx === null) {
        return newRandomEvent("", []);
    }
    const event = randomEvents[lastIdx];
    const res = pickResult(event.results[choice]);
    const triggeredAchievements = [];
    if (event.achievements?.[choice]) {
        const ach = event.achievements[choice];
        triggeredAchievements.push(ach);
        if (!gameState.achievements.includes(ach)) gameState.achievements.push(ach);
    }
    if (res.endGame || (event.end_game_choices && event.end_game_choices.includes(choice))) {
        gameState.userState.randomUsed.add(lastIdx);
        return { message: `${res.text}\n游戏结束！`, game_over: true, achievements: triggeredAchievements };
    }
    gameState.score += 1;
    gameState.userState.randomUsed.add(lastIdx);
    return newRandomEvent(res.text, triggeredAchievements);
}

// 获取新的随机事件，并拼接上上一次的结果
function newRandomEvent(prevResult = "", triggeredAchievements = []) {
    const randomEvents = getRandomEvents();
    const unused = [...Array(randomEvents.length).keys()].filter(i => !gameState.userState.randomUsed.has(i));
    if (unused.length === 0) {
        return {
            message: `${prevResult}\n所有事件已完成，游戏结束！`,
            game_over: true,
            achievements: triggeredAchievements
        };
    }
    const idx = unused[Math.floor(Math.random() * unused.length)];
    gameState.userState.lastRandomIdx = idx;
    const event = randomEvents[idx];
    const msg = prevResult ? `${prevResult}\n${event.question}${getContributorStr(event)}` 
                            : `${event.question}${getContributorStr(event)}`;
    return {
        message: msg,
        options: Object.entries(event.choices).map(([key, text]) => ({ key, text })),
        next_event: 'random_event',
        achievements: triggeredAchievements
    };
}

// 获取成就与得分
const getAchievements = () => ({ score: gameState.score, achievements: gameState.achievements });

// 清除数据
const clearData = () => {
    gameState.achievements = [];
    gameState.score = 0;
    return { message: '数据已清除！' };
};

// ----- 以下为 UI 相关代码 -----

const splitMessage = message => {
    if (!message?.includes('\n')) return [message, ''];
    const idx = message.indexOf('\n');
    let resultText = message.slice(0, idx).trim();
    let nextQuestion = message.slice(idx + 1).trim();
    if (nextQuestion && !nextQuestion.startsWith('>>>')) {
        const idx2 = nextQuestion.indexOf('\n');
        if (idx2 !== -1) {
            resultText += '\n' + nextQuestion.slice(0, idx2).trim();
            nextQuestion = nextQuestion.slice(idx2 + 1).trim();
        } else {
            resultText += '\n' + nextQuestion;
            nextQuestion = '';
        }
    }
    return [resultText, nextQuestion];
};

const updateUI = data => {
    const [resultText, nextQuestion] = splitMessage(data.message);
    if (resultText) gameState.lastResult = resultText;
    resultDiv.textContent = gameState.lastResult;
    messageDiv.textContent = nextQuestion;
    updateOptions(data);
    updateAchievements(data);
    toggleCoverImage();
};

const updateOptions = data => {
    optionsDiv.innerHTML = '';
    bottomOptionsDiv.innerHTML = '';
    if (!data.options) return;
    const { options, game_over, start_event } = data;
    const bottomBtns = [];
    options.forEach(option => {
        if (['关于', '退出', '查看成就', '清除数据'].includes(option.text)) {
            bottomBtns.push(option);
        } else {
            const btn = createButton(option, start_event);
            btn.className = option.text === '开始游戏' ? 'start-btn' : '';
            optionsDiv.appendChild(btn);
        }
    });
    bottomBtns.forEach(option => {
        const btn = createButton(option, start_event);
        btn.className = 'half-btn';
        bottomOptionsDiv.appendChild(btn);
    });
    if (data.game_over) {
        const btn = document.createElement('button');
        btn.textContent = '重新开始';
        btn.onclick = () => window.location.reload();
        optionsDiv.appendChild(btn);
    }
};

const createButton = (option, start_event) => {
    const btn = document.createElement('button');
    btn.textContent = option.text;
    switch(option.text) {
        case '关于': 
            btn.onclick = showAbout; 
            break;
        case '查看成就': 
            btn.onclick = showAchievements; 
            break;
        case '清除数据': 
            btn.onclick = confirmClearData; 
            break;
        default: 
            btn.onclick = () => makeChoiceHandler(option.key, start_event);
    }
    return btn;
};

const makeChoiceHandler = (choice, start_event = null) => {
    let data;
    switch(gameState.currentApi) {
        case 'choose_start': data = chooseStart(choice); break;
        case 'fixed_event': data = fixedEvent(choice); break;
        case 'random_event': data = randomEvent(choice); break;
        default: data = startGame();
    }
    updateUI(data);
    if (data.game_over) {
        gameState.currentApi = 'choose_start';
    } else if (data.next_event) {
        gameState.currentApi = data.next_event;
    }
};

const updateAchievements = data => {
    if (!data.achievements?.length) {
        achievementsDiv.style.display = gameState.allAchievements.size > 0 ? 'block' : 'none';
        return;
    }
    data.achievements.forEach(ach => gameState.allAchievements.add(ach));
    if (gameState.allAchievements.size) {
        achievementsListDiv.innerHTML = '';
        Array.from(gameState.allAchievements).reverse().forEach(ach => {
            const p = document.createElement('p');
            p.textContent = ach;
            achievementsListDiv.appendChild(p);
        });
        achievementsDiv.style.display = 'block';
    }
};

const toggleCoverImage = () => {
    coverImg.style.display = gameState.currentApi === 'choose_start' ? 'block' : 'none';
};

const showAchievements = () => {
    const { score, achievements } = getAchievements();
    const msg = achievements.length > 0 
        ? `当前得分：${score}\n已获得成就：\n${achievements.join("\n")}`
        : `当前得分：${score}\n还没有获得任何成就。`;
    alert(msg);
};

const confirmClearData = () => {
    if (confirm("确定要清除所有成就和分数吗？")) {
        alert(clearData().message);
    }
};

const showAbout = () => {
    const aboutDiv = document.getElementById('about');
    aboutDiv.innerHTML = `
        <pre style="white-space:pre-line;">
About OK School Life
Version ${gameState.version}
At home, May 30, 2025

Hi, I'm Still Alive (还活着), the developer of this game.
[保持原有关于文本内容...]
        </pre>
        <button onclick="hideAbout()">返回</button>`;
    document.querySelectorAll('#result, #message, #options, #achievements, #bottom-options')
        .forEach(el => el.style.display = 'none');
    aboutDiv.style.display = 'block';
};

const hideAbout = () => {
    document.getElementById('about').style.display = 'none';
    document.querySelectorAll('#result, #message, #options, #achievements, #bottom-options')
        .forEach(el => el.style.display = '');
};

const hideLoadingScreen = () => {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 400);
    }
    document.querySelector('.game-container').style.display = '';
};

// 资源加载函数
const preloadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = reject;
    img.src = src;
});

// 加载游戏数据（使用本地 data/events.json）
async function loadGameData() {
    try {
        const res = await fetch(GAME_DATA_URL);
        if (!res.ok) throw new Error('Network response was not ok');
        gameState.eventData = await res.json();
        gameState.version = gameState.eventData.metadata?.version || gameState.version;
    } catch (err) {
        console.error('Error loading game data:', err);
        gameState.eventData = undefined;
    }
    return gameState.eventData;
}

// 初始化游戏：加载资源后启动
async function initGame() {
    try {
        await Promise.all([
            preloadImage('images/icons/icon-v4.png'),
            preloadImage('https://cdn.jsdelivr.net/gh/CheongSzesuen/OK-School-Life-Web/images/welcome/mini/welcome-v4.png'),
            loadGameData()
        ]);
    } catch (err) {
        console.error('Error loading resources:', err);
    } finally {
        updateUI(startGame());
        hideLoadingScreen();
    }
}

window.onload = initGame;