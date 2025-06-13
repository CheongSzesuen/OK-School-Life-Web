// 游戏数据URL
const GAME_DATA_URL = 'https://cdn.jsdelivr.net/gh/still-alive-hhz/OK-School-Life@main/assets/data/events.json';

const gameState = {
    currentApi: '/api/choose_start',
    lastResult: "",
    allAchievements: new Set(),
    userState: {
        school: null,
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

// 辅助函数
function getContributorStr(event) {
    return event.contributors && event.contributors.length > 0 ? `（贡献者：${event.contributors.join("、")}）` : "";
}

function pickResult(resultValue) {
    if (Array.isArray(resultValue)) {
        const probs = resultValue.map(item => item.prob || 1/resultValue.length);
        const chosen = weightedRandom(resultValue, probs);
        return { 
            text: chosen.rd_result || chosen.text || "", 
            endGame: chosen.end_game || false 
        };
    }
    return { text: resultValue, endGame: false };
}

function weightedRandom(items, weights) {
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;
    let weightSum = 0;
    
    for (let i = 0; i < items.length; i++) {
        weightSum += weights[i];
        if (random <= weightSum) return items[i];
    }
    return items[items.length - 1];
}

function getEventList() {
    return gameState.eventData?.metadata?.start_options || [];
}

function getGroupEvents(groupKey) {
    return gameState.eventData?.events?.fixed_events?.[groupKey] || [];
}

function getRandomEvents() {
    return gameState.eventData?.events?.random_events || [];
}

// API函数
function apiStartGame() {
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

// 修改后的 apiChooseStart：根据用户选择的家庭类型（1-富裕、2-普通、3-贫穷）
function apiChooseStart(choice) {
    if (choice === '5') {
        return { message: '感谢游玩，期待下次再见！', game_over: true };
    }

    // 重置游戏状态，并记录所选家庭类型
    gameState.userState = {
        familyIndex: choice, // 存储选择（"1", "2" 或 "3"）
        eventIdx: 0,
        stage: "fixed",
        randomUsed: new Set(),
        lastRandomIdx: null
    };

    const familyOption = getEventList()[parseInt(choice) - 1]; // 从 metadata.start_options 中选择
    const groupKey = `group_${choice}`; // 假定新 events 中固定事件的组key为 group_1, group_2, group_3
    const eventList = getGroupEvents(groupKey);
    if (!eventList.length) return { message: '未知事件', game_over: true };

    const firstEvent = eventList[0];
    return {
        message: `${familyOption}。\n${firstEvent.question}${getContributorStr(firstEvent)}`,
        options: Object.entries(firstEvent.choices).map(([key, text]) => ({ key, text })),
        next_event: 'fixed_event'
    };
}

// 新增加固定事件处理函数（原 apiChooseSchool 改造）
function apiFixedEvent(choice) {
    const familyIndex = gameState.userState.familyIndex;
    const groupKey = `group_${familyIndex}`;
    const eventList = getGroupEvents(groupKey);
    if (!eventList.length) return { message: '未知事件', game_over: true };

    const event = eventList[gameState.userState.eventIdx];
    if (typeof event !== 'object') {
        gameState.userState.eventIdx += 1;
        return handleEventTransition(event, "");
    }

    const { text, endGame } = pickResult(event.results[choice]);
    const triggeredAchievements = [];
    if (event.achievements?.[choice]) {
        const achievement = event.achievements[choice];
        triggeredAchievements.push(achievement);
        if (!gameState.achievements.includes(achievement)) {
            gameState.achievements.push(achievement);
        }
    }
    
    if (endGame || event.end_game_choices?.includes(choice)) {
        return {
            message: `${text}\n你失败了，游戏结束！`,
            game_over: true,
            achievements: triggeredAchievements
        };
    }
    
    gameState.userState.eventIdx += 1;
    gameState.score += 1;
    return handleEventTransition(eventList[gameState.userState.eventIdx], text, triggeredAchievements);
}

function handleEventTransition(nextEvent, prevResult, achievements = []) {
    if (nextEvent) {
        if (typeof nextEvent === 'object') {
            return {
                message: `${prevResult}\n${nextEvent.question}${getContributorStr(nextEvent)}`,
                options: Object.entries(nextEvent.choices).map(([key, text]) => ({ key, text })),
                next_event: 'school_event',
                achievements
            };
        }
        return {
            message: `${prevResult}\n${nextEvent}`,
            options: [],
            next_event: 'school_event',
            achievements
        };
    }

    gameState.userState.stage = "random";
    return apiRandomEvent();
}

function apiRandomEvent(choice) {
    const randomEvents = getRandomEvents();
    const { lastRandomIdx, randomUsed } = gameState.userState;

    if (choice === undefined || lastRandomIdx === null) {
        return getNewRandomEvent(randomEvents, randomUsed);
    }

    const event = randomEvents[lastRandomIdx];
    if (!event) return getNewRandomEvent(randomEvents, randomUsed);

    const { text, endGame } = pickResult(event.results[choice]);
    const triggeredAchievements = [];
    
    if (event.achievements?.[choice]) {
        const achievement = event.achievements[choice];
        triggeredAchievements.push(achievement);
        if (!gameState.achievements.includes(achievement)) {
            gameState.achievements.push(achievement);
        }
    }

    if (endGame || event.end_game_choices?.includes(choice)) {
        randomUsed.add(lastRandomIdx);
        return {
            message: `${text}\n游戏结束！`,
            game_over: true,
            achievements: triggeredAchievements
        };
    }

    randomUsed.add(lastRandomIdx);
    gameState.score += 1;
    return getNewRandomEvent(randomEvents, randomUsed, text, triggeredAchievements);
}

function getNewRandomEvent(events, usedIndices, prevResult = "", achievements = []) {
    const unused = [...Array(events.length).keys()].filter(i => !usedIndices.has(i));
    if (unused.length === 0) {
        return {
            message: `${prevResult}\n所有事件已完成，游戏结束！`,
            achievements,
            game_over: true
        };
    }

    const idx = unused[Math.floor(Math.random() * unused.length)];
    gameState.userState.lastRandomIdx = idx;
    const event = events[idx];
    
    return {
        message: `${prevResult}\n${event.question}${getContributorStr(event)}`,
        options: Object.entries(event.choices).map(([key, text]) => ({ key, text })),
        next_event: 'random_event',
        achievements
    };
}

function apiGetAchievements() {
    return {
        score: gameState.score,
        achievements: gameState.achievements
    };
}

function apiClearData() {
    gameState.achievements = [];
    gameState.score = 0;
    return { message: '数据已清除！' };
}

// UI函数
function updateUI(data) {
    const [resultText, nextQuestion] = splitMessage(data.message);
    if (resultText) gameState.lastResult = resultText;

    document.getElementById('result').textContent = gameState.lastResult;
    document.getElementById('message').textContent = nextQuestion;

    updateOptions(data);
    updateAchievements(data);
    toggleCoverImage();
}

function splitMessage(message) {
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
}

function updateOptions(data) {
    const optionsDiv = document.getElementById('options');
    const bottomOptionsDiv = document.getElementById('bottom-options');
    optionsDiv.innerHTML = '';
    bottomOptionsDiv.innerHTML = '';

    if (!data.options) return;

    const { options, game_over, start_event } = data;
    const bottomBtns = [];
    
    options.forEach(option => {
        if (['关于', '退出', '查看成就', '清除数据'].includes(option.text)) {
            bottomBtns.push(option);
        } else {
            const button = createButton(option, start_event);
            button.className = option.text === '开始游戏' ? 'start-btn' : '';
            optionsDiv.appendChild(button);
        }
    });

    bottomBtns.forEach(option => {
        const button = createButton(option, start_event);
        button.className = 'half-btn';
        bottomOptionsDiv.appendChild(button);
    });

    if (game_over) {
        const button = document.createElement('button');
        button.textContent = '重新开始';
        button.onclick = () => window.location.reload();
        optionsDiv.appendChild(button);
    }
}

function createButton(option, start_event) {
    const button = document.createElement('button');
    button.textContent = option.text;
    
    switch(option.text) {
        case '关于': button.onclick = showAbout; break;
        case '查看成就': button.onclick = showAchievements; break;
        case '清除数据': button.onclick = confirmClearData; break;
        default: button.onclick = () => makeChoice(option.key, start_event);
    }
    return button;
}

function updateAchievements(data) {
    const achievementsDiv = document.getElementById('achievements');
    const listDiv = document.getElementById('achievements-list');
    
    if (!data.achievements?.length) {
        achievementsDiv.style.display = gameState.allAchievements.size > 0 ? 'block' : 'none';
        return;
    }

    let hasNew = false;
    data.achievements.forEach(achievement => {
        if (!gameState.allAchievements.has(achievement)) hasNew = true;
        gameState.allAchievements.add(achievement);
    });

    if (gameState.allAchievements.size > 0) {
        listDiv.innerHTML = '';
        Array.from(gameState.allAchievements).reverse().forEach(achievement => {
            const p = document.createElement('p');
            p.textContent = achievement;
            listDiv.appendChild(p);
        });
        achievementsDiv.style.display = 'block';
    }
}

function toggleCoverImage() {
    document.getElementById('cover-img').style.display = 
        gameState.currentApi === '/api/choose_start' ? 'block' : 'none';
}

function makeChoice(choice, startEvent = null) {
    let data;
    switch (gameState.currentApi) {
        case '/api/choose_start': 
            data = apiChooseStart(choice); 
            break;
        case '/api/fixed_event': 
            data = apiFixedEvent(choice); 
            break;
        case '/api/school_event': 
            data = apiSchoolEvent(choice); 
            break;
        case '/api/random_event': 
            data = apiRandomEvent(choice); 
            break;
        default: 
            data = apiStartGame();
    }
    updateUI(data);
    updateCurrentApi(data);
}

// 修改 updateCurrentApi，保持原逻辑不变
function updateCurrentApi(data) {
    if (data.game_over) {
        gameState.currentApi = '/api/choose_start';
    } else {
        gameState.currentApi = `/api/${data.next_event}`;
    }
}

function showAchievements() {
    const { score, achievements } = apiGetAchievements();
    const msg = achievements.length > 0 
        ? `当前得分：${score}\n已获得成就：\n${achievements.join("\n")}`
        : `当前得分：${score}\n还没有获得任何成就。`;
    alert(msg);
}

function confirmClearData() {
    if (confirm("确定要清除所有成就和分数吗？")) {
        alert(apiClearData().message);
    }
}

function showAbout() {
    const aboutDiv = document.getElementById('about');
    aboutDiv.innerHTML = `
        <pre style="white-space:pre-line;">
            About OK School Life
            Version ${gameState.version}
            At home, May 30, 2025

            Hi, I'm Stiil Alive, in Chinese "还活着", the developer of this game.
            [保持原有关于文本内容...]
        </pre>
        <button onclick="hideAbout()">返回</button>`;
    
    document.querySelectorAll('#result, #message, #options, #achievements, #bottom-options')
        .forEach(el => el.style.display = 'none');
    aboutDiv.style.display = 'block';
}

function hideAbout() {
    document.getElementById('about').style.display = 'none';
    document.querySelectorAll('#result, #message, #options, #achievements, #bottom-options')
        .forEach(el => el.style.display = '');
}

function hideLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 400);
    }
    document.querySelector('.game-container').style.display = '';
}

// 资源加载
async function loadGameData() {
    try {
        const response = await fetch(GAME_DATA_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        gameState.eventData = await response.json();
        gameState.version = gameState.eventData.metadata?.version || gameState.version;
    } catch (error) {
        console.error('Error loading game data:', error);
        // 取消内置数据，保持 eventData 为空
        gameState.eventData = undefined;
    }
    return gameState.eventData;
}

async function preloadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
    });
}

// 初始化游戏
async function initGame() {
    try {
        await Promise.all([
            preloadImage('images/icons/icon-v4.png'),
            preloadImage('https://cdn.jsdelivr.net/gh/CheongSzesuen/OK-School-Life-Web/images/welcome/mini/welcome-v4.png'),
            loadGameData()
        ]);
    } catch (error) {
        console.error('Error loading resources:', error);
    } finally {
        updateUI(apiStartGame());
        hideLoadingScreen();
    }
}

window.onload = initGame;