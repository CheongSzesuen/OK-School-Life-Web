const GAME_DATA_URL = 'https://cdn.jsdelivr.net/gh/still-alive-hhz/OK-School-Life@refs/heads/main/assets/data/events.json';

const gameState = {
    currentApi: 'choose_start',
    lastResult: "",
    allAchievements: new Set(),
    userState: {
        school: null,
        familyIndex: null,
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

const getContributorStr = event =>
    event.contributors && event.contributors.length ? `（贡献者：${event.contributors.join("、")}）` : "";

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

const getEventList = () => gameState.eventData?.metadata?.start_options || [];
const getGroupEvents = groupKey => gameState.eventData?.events?.fixed_events?.[groupKey] || [];
const getRandomEvents = () => gameState.eventData?.events?.random_events || [];

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
    const msg = prevResult ? `${prevResult}\n${event.question}${getContributorStr(event)}` : `${event.question}${getContributorStr(event)}`;
    return {
        message: msg,
        options: Object.entries(event.choices).map(([key, text]) => ({ key, text })),
        next_event: 'random_event',
        achievements: triggeredAchievements
    };
}

const getAchievements = () => ({ score: gameState.score, achievements: gameState.achievements });
const clearData = () => {
    gameState.achievements = [];
    gameState.score = 0;
    return { message: '数据已清除！' };
};

function updateUI(data) {
    let questionText = data.message || '';
    let lines = questionText.split('\n');
    let resultText = '';
    let nextQuestion = '';

    if (lines.length > 1) {
        resultText = lines[0].trim();
        nextQuestion = lines.slice(1).join('\n').trim();
    } else {
        resultText = '';
        nextQuestion = questionText.trim();
    }

    document.getElementById('result').textContent = resultText;
    document.getElementById('message').textContent = nextQuestion;

    const optionsDiv = document.getElementById('options');
    const bottomOptionsDiv = document.getElementById('bottom-options');
    optionsDiv.innerHTML = '';
    bottomOptionsDiv.innerHTML = '';

    if (data.options) {
        const bottomBtns = [];
        data.options.forEach(optionObj => {
            if (
                optionObj.text === '关于' ||
                optionObj.text === '退出' ||
                optionObj.text === '查看成就' ||
                optionObj.text === '清除数据'
            ) {
                bottomBtns.push(optionObj);
            } else {
                const button = document.createElement('button');
                button.textContent = optionObj.text;
                if (optionObj.text === '开始游戏') button.className = 'start-btn';
                button.onclick = () => makeChoiceHandler(optionObj.key);
                optionsDiv.appendChild(button);
            }
        });
        bottomBtns.forEach(optionObj => {
            const button = document.createElement('button');
            button.textContent = optionObj.text;
            button.className = 'half-btn';
            if (optionObj.text === '关于') button.onclick = showAbout;
            else if (optionObj.text === '退出') button.onclick = () => makeChoiceHandler(optionObj.key);
            else if (optionObj.text === '查看成就') button.onclick = showAchievements;
            else if (optionObj.text === '清除数据') button.onclick = confirmClearData;
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
        data.achievements.forEach(achievement => gameState.allAchievements.add(achievement));
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
    coverImg.style.display = gameState.currentApi === 'choose_start' ? 'block' : 'none';
}

function makeChoiceHandler(choice) {
    let data;
    switch (gameState.currentApi) {
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
}

function showAchievements() {
    const data = getAchievements();
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
        alert(clearData().message);
    }
}

function showAbout() {
    const aboutDiv = document.getElementById('about');
    aboutDiv.innerHTML = `<pre style="white-space:pre-line;">About OK School Life
Version ${gameState.version}
At home, May 30, 2025

Hi, I'm Still Alive, in Chinese “还活着”, the developer of this game.

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

async function loadGameData() {
    try {
        const res = await fetch(GAME_DATA_URL + '?t=' + Date.now());
        if (!res.ok) throw new Error('Network response was not ok');
        gameState.eventData = await res.json();
        gameState.version = gameState.eventData.metadata?.version || gameState.version;
    } catch (err) {
        console.error('Error loading game data:', err);
        gameState.eventData = undefined;
    }
    return gameState.eventData;
}

window.onload = async function() {
    await loadGameData();
    updateUI(startGame());
};