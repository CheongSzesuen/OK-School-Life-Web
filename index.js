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
    eventData: null, // 将从JSON加载的数据存储在这里
    version: "v0.4.0"
};

// 辅助函数
function getContributorStr(event) {
    if (event.contributors && event.contributors.length > 0) {
        return "（由" + event.contributors.join("、") + "贡献）";
    }
    return "";
}

function pickResult(resultValue) {
    if (Array.isArray(resultValue)) {
        const probs = resultValue.map(item => item.prob || 1/resultValue.length);
        const chosen = weightedRandom(resultValue, probs);
        const text = chosen.rd_result || chosen.text || "";
        const endGame = chosen.end_game || false;
        return { text, endGame };
    } else {
        return { text: resultValue, endGame: false };
    }
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
    const meta = gameState.eventData.metadata || {};
    return meta.start_options || [];
}

function getGroupEvents(groupKey) {
    const events = gameState.eventData.events || {};
    const fixed = events.fixed_events || {};
    return fixed[groupKey] || [];
}

function getRandomEvents() {
    const events = gameState.eventData.events || {};
    return events.random_events || [];
}

// 游戏API函数
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

function apiChooseStart(choice) {
    gameState.userState = {
        school: null,
        eventIdx: 0,
        stage: "fixed",
        randomUsed: new Set(),
        lastRandomIdx: null
    };

    if (choice === '5') {
        return {
            message: '感谢游玩，期待下次再见！',
            game_over: true
        };
    }

    const eventList = getEventList();
    const startEvent = weightedRandom(eventList, [0.2, 0.5, 0.3]);
    
    return {
        message: `${startEvent}。\n你中考考得很好，现在可以选择学校。`,
        options: [
            { key: '1', text: '羊县中学' },
            { key: '2', text: '闪西省汗忠中学' },
            { key: '3', text: '汗忠市龙港高级中学' }
        ],
        start_event: startEvent,
        next_event: 'choose_school'
    };
}

function apiChooseSchool(school, startEvent) {
    gameState.userState = {
        school,
        eventIdx: 0,
        stage: "fixed",
        randomUsed: new Set(),
        lastRandomIdx: null
    };

    let eventList;
    if (school === '1') {
        eventList = getGroupEvents("group_1");
    } else if (school === '2') {
        eventList = getGroupEvents("group_2");
    } else if (school === '3') {
        eventList = getGroupEvents("group_3");
    } else {
        return { message: '未知学校', game_over: true };
    }

    const event = eventList[0];
    let msg, options;
    
    if (typeof event === 'object') {
        msg = event.question + getContributorStr(event);
        options = Object.entries(event.choices).map(([key, text]) => ({ key, text }));
    } else {
        msg = event;
        options = [];
    }
    
    return {
        message: msg,
        options,
        next_event: 'school_event'
    };
}

function apiSchoolEvent(choice) {
    const { school, eventIdx } = gameState.userState;
    let eventListNow;
    
    if (school === '1') {
        eventListNow = getGroupEvents("group_1");
    } else if (school === '2') {
        eventListNow = getGroupEvents("group_2");
    } else if (school === '3') {
        eventListNow = getGroupEvents("group_3");
    } else {
        return { message: '未知学校', game_over: true };
    }

    const event = eventListNow[eventIdx];
    let result, isEnd, msg, options, achievementsDict, endGameChoices;
    const triggeredAchievements = [];
    
    if (typeof event === 'object') {
        const picked = pickResult(event.results[choice]);
        result = picked.text;
        isEnd = picked.endGame;
        msg = event.question + getContributorStr(event);
        options = Object.entries(event.choices).map(([key, text]) => ({ key, text }));
        achievementsDict = event.achievements || {};
        endGameChoices = event.end_game_choices || [];
        
        if (achievementsDict[choice]) {
            triggeredAchievements.push(achievementsDict[choice]);
            if (!gameState.achievements.includes(achievementsDict[choice])) {
                gameState.achievements.push(achievementsDict[choice]);
            }
        }
    } else {
        result = "";
        isEnd = false;
        msg = event;
        options = [];
        achievementsDict = {};
        endGameChoices = [];
    }

    if (isEnd || endGameChoices.includes(choice)) {
        return {
            message: result + "\n你失败了，游戏结束！",
            game_over: true,
            achievements: triggeredAchievements
        };
    }

    gameState.userState.eventIdx += 1;
    gameState.score += 1;

    if (gameState.userState.eventIdx < eventListNow.length) {
        const nextEvent = eventListNow[gameState.userState.eventIdx];
        let nextMsg, nextOptions;
        
        if (typeof nextEvent === 'object') {
            nextMsg = nextEvent.question + getContributorStr(nextEvent);
            nextOptions = Object.entries(nextEvent.choices).map(([key, text]) => ({ key, text }));
        } else {
            nextMsg = nextEvent;
            nextOptions = [];
        }
        
        return {
            message: result + "\n" + nextMsg,
            options: nextOptions,
            next_event: 'school_event',
            achievements: triggeredAchievements
        };
    } else {
        gameState.userState.stage = "random";
        const randomEvents = getRandomEvents();
        const unused = [...Array(randomEvents.length).keys()]
            .filter(i => !gameState.userState.randomUsed.has(i));
        
        if (unused.length === 0) {
            return {
                message: result + "\n所有事件已完成，游戏结束！",
                achievements: triggeredAchievements,
                game_over: true
            };
        }
        
        const idx = unused[Math.floor(Math.random() * unused.length)];
        gameState.userState.randomUsed.add(idx);
        const event = randomEvents[idx];
        msg = event.question + getContributorStr(event);
        options = Object.entries(event.choices).map(([key, text]) => ({ key, text }));
        
        return {
            message: result + "\n" + msg,
            options,
            next_event: 'random_event',
            achievements: triggeredAchievements
        };
    }
}

function apiRandomEvent(choice) {
    const randomEvents = getRandomEvents();
    
    if (choice === undefined || gameState.userState.lastRandomIdx === null) {
        const unused = [...Array(randomEvents.length).keys()]
            .filter(i => !gameState.userState.randomUsed.has(i));
        
        if (unused.length === 0) {
            return { message: '所有事件已完成，游戏结束！', game_over: true };
        }
        
        const idx = unused[Math.floor(Math.random() * unused.length)];
        gameState.userState.lastRandomIdx = idx;
        const event = randomEvents[idx];
        const msg = event.question + getContributorStr(event);
        const options = Object.entries(event.choices).map(([key, text]) => ({ key, text }));
        
        return {
            message: msg,
            options,
            next_event: 'random_event'
        };
    }

    const idx = gameState.userState.lastRandomIdx;
    if (idx === null) {
        const unused = [...Array(randomEvents.length).keys()]
            .filter(i => !gameState.userState.randomUsed.has(i));
        
        if (unused.length === 0) {
            return { message: '所有事件已完成，游戏结束！', game_over: true };
        }
        
        const newIdx = unused[Math.floor(Math.random() * unused.length)];
        gameState.userState.lastRandomIdx = newIdx;
        const event = randomEvents[newIdx];
        const msg = event.question + getContributorStr(event);
        const options = Object.entries(event.choices).map(([key, text]) => ({ key, text }));
        
        return {
            message: msg,
            options,
            next_event: 'random_event'
        };
    }

    const event = randomEvents[idx];
    const picked = pickResult(event.results[choice]);
    const result = picked.text;
    const isEnd = picked.endGame;
    const endGameChoices = event.end_game_choices || [];
    const achievementsDict = event.achievements || {};
    const triggeredAchievements = [];
    
    if (achievementsDict[choice]) {
        triggeredAchievements.push(achievementsDict[choice]);
        if (!gameState.achievements.includes(achievementsDict[choice])) {
            gameState.achievements.push(achievementsDict[choice]);
        }
    }

    if (isEnd || endGameChoices.includes(choice)) {
        gameState.userState.randomUsed.add(idx);
        return {
            message: result + "\n游戏结束！",
            game_over: true,
            achievements: triggeredAchievements
        };
    }

    gameState.userState.randomUsed.add(idx);
    gameState.score += 1;
    
    const unused = [...Array(randomEvents.length).keys()]
        .filter(i => !gameState.userState.randomUsed.has(i));
    
    if (unused.length === 0) {
        return {
            message: result + "\n所有事件已完成，游戏结束！",
            achievements: triggeredAchievements,
            game_over: true
        };
    }
    
    const nextIdx = unused[Math.floor(Math.random() * unused.length)];
    gameState.userState.lastRandomIdx = nextIdx;
    const nextEvent = randomEvents[nextIdx];
    const msg = nextEvent.question + getContributorStr(nextEvent);
    const options = Object.entries(nextEvent.choices).map(([key, text]) => ({ key, text }));
    
    return {
        message: result + "\n" + msg,
        options,
        next_event: 'random_event',
        achievements: triggeredAchievements
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
    let questionText = data.message || '';
    let resultText = '';
    let nextQuestion = '';

    if (questionText.includes('\n')) {
        const idx = questionText.indexOf('\n');
        resultText = questionText.slice(0, idx).trim();
        nextQuestion = questionText.slice(idx + 1).trim();
        
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
    } else {
        resultText = questionText;
        nextQuestion = '';
    }

    if (resultText) gameState.lastResult = resultText;

    document.getElementById('result').textContent = gameState.lastResult;
    document.getElementById('message').textContent = nextQuestion;

    const optionsDiv = document.getElementById('options');
    const bottomOptionsDiv = document.getElementById('bottom-options');
    optionsDiv.innerHTML = '';
    bottomOptionsDiv.innerHTML = '';

    if (data.options) {
        const bottomBtns = [];
        data.options.forEach((optionObj, idx) => {
            if (
                optionObj.text === '关于' ||
                optionObj.text === '退出' ||
                optionObj.text === '查看成就' ||
                optionObj.text === '清除数据'
            ) {
                bottomBtns.push({option: optionObj.text, key: optionObj.key});
            } else {
                const button = document.createElement('button');
                button.textContent = optionObj.text;
                if (optionObj.text === '开始游戏') {
                    button.className = 'start-btn';
                }
                button.onclick = () => makeChoice(optionObj.key, data.start_event);
                optionsDiv.appendChild(button);
            }
        });
        
        bottomBtns.forEach(({option, key}) => {
            const button = document.createElement('button');
            button.textContent = option;
            button.className = 'half-btn';
            if (option === '关于') {
                button.onclick = showAbout;
            } else if (option === '退出') {
                button.onclick = () => makeChoice(key, data.start_event);
            } else if (option === '查看成就') {
                button.onclick = showAchievements;
            } else if (option === '清除数据') {
                button.onclick = confirmClearData;
            }
            bottomOptionsDiv.appendChild(button);
        });
    }
    
    if (data.game_over) {
        const button = document.createElement('button');
        button.textContent = '重新开始';
        button.onclick = () => window.location.reload();
        optionsDiv.appendChild(button);
    }
    
    if (data.achievements) {
        const achievementsDiv = document.getElementById('achievements');
        const listDiv = document.getElementById('achievements-list');
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

    const coverImg = document.getElementById('cover-img');
    if (gameState.currentApi === '/api/choose_start') {
        coverImg.style.display = 'block';
    } else {
        coverImg.style.display = 'none';
    }
}

function makeChoice(choice, startEvent=null) {
    let data;
    
    switch (gameState.currentApi) {
        case '/api/choose_start':
            data = apiChooseStart(choice);
            break;
        case '/api/choose_school':
            data = apiChooseSchool(choice, startEvent);
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
    
    if (data.next_event === 'school_event') {
        gameState.currentApi = '/api/school_event';
    } else if (data.next_event === 'random_event') {
        gameState.currentApi = '/api/random_event';
    } else if (data.next_event === 'choose_school') {
        gameState.currentApi = '/api/choose_school';
    } else if (data.game_over) {
        gameState.currentApi = '/api/choose_start';
    }
}

function showAchievements() {
    const data = apiGetAchievements();
    let msg = "当前得分：" + data.score + "\n";
    
    if (data.achievements.length > 0) {
        msg += "已获得成就：\n" + data.achievements.join("\n");
    } else {
        msg += "还没有获得任何成就。";
    }
    
    alert(msg);
}

function confirmClearData() {
    if (confirm("确定要清除所有成就和分数吗？")) {
        const data = apiClearData();
        alert(data.message);
    }
}

function showAbout() {
    const aboutDiv = document.getElementById('about');
    aboutDiv.innerHTML = `<pre style="white-space:pre-line;">About OK School Life
Version 0.4
At home, May 30, 2025

Hi, I'm Stiil Alive, in Chinese "还活着", the developer of this game.

First of all, thank you for playing this game.
This is a simple text-based game where you can choose your school life path.
You can make choices, earn achievements, and see how your decisions affect your story.
The game includes some lighthearted elements, as well as black humor elements.
Most of the content is based on my own school life experiences, so it may not be suitable for everyone.
And I'm trying to make it funnier, so there are some jokes in it.

I'm a newbie developer, and this is my first game.
To be honest, I don't know how to make a game. I just wanted to create a game that I would enjoy playing.
I must say that so many people have helped me a lot, including my friends and classmates.
They're WaiJade, lagency, 智心逍遥, sky, YaXuan, Tomato, GuoHao, and many others.
Especially, WaiJade, the co-developer of this game, wants to say something:

"I am WaiJade. 
Thanks for developing this game, which has reignited my passion for programming. 
I was primarily responsible for the script that automates the packaging of the game's executable file,
and contributed a little to the event library. 
Thank you for playing!"

I also want to thank the Modern AI Technology, especially OpenAI, 
for providing the tools and resources that made this game possible.
I'd like to thank Github for hosting the source code and allowing me to share it with everyone.

This game is open source, and you can find the source code on GitHub:
https://github.com/still-alive-hhz/OK-School-Life
The game is still in development, so there may be bugs or incomplete features.
If you have any questions or suggestions, please feel free to contact me.

Enjoy the game!</pre>
<button onclick="hideAbout()">返回</button>`;
    aboutDiv.style.display = 'block';
    document.getElementById('result').style.display = 'none';
    document.getElementById('message').style.display = 'none';
    document.getElementById('options').style.display = 'none';
    document.getElementById('achievements').style.display = 'none';
    document.getElementById('bottom-options').style.display = 'none';
}

function hideAbout() {
    document.getElementById('about').style.display = 'none';
    document.getElementById('result').style.display = '';
    document.getElementById('message').style.display = '';
    document.getElementById('options').style.display = '';
    document.getElementById('achievements').style.display = '';
    document.getElementById('bottom-options').style.display = '';
}

function hideLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 400);
    }
    document.querySelector('.game-container').style.display = '';
}

// 加载图片并返回Promise
function preloadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new window.Image();
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
    });
}

// 加载JSON数据并初始化游戏
function loadGameData() {
    Promise.all([
        fetch('data/events.json')
            .then(response => {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            }),
        preloadImage('images/icons/icon-v4.png'),
        preloadImage('https://github.com/CheongSzesuen/OK-School-Life-Web/blob/main/images/welcome/mini/welcome-v4.png?raw=true')
    ])
    .then(([data]) => {
        gameState.eventData = data;
        gameState.version = data.metadata.version || "v0.4.0";
        const initData = apiStartGame();
        updateUI(initData);
        hideLoadingScreen();
    })
    .catch(error => {
        console.error('Error loading game data:', error);
        alert('加载游戏数据失败，请刷新页面重试。');
    });
}

// 初始化游戏
window.onload = loadGameData;