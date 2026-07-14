/**
 * 活人泰语点读卡 - 应用逻辑
 * SPA 路由 / 页面渲染 / 搜索筛选 / 收藏 / 音频播放
 */

(function () {
  'use strict';

  const { CATEGORIES, SENTENCES } = window.APP_DATA;

  /* ===== 状态管理 ===== */
  const state = {
    currentRoute: 'home',
    currentCategory: null,
    filters: { diff: 'all', tone: 'all' },
    searchQuery: '',
    favorites: loadFavorites(),
    currentPlayingId: null,
    voiceGender: localStorage.getItem('thai_gender') || 'female',
    playbackSpeed: parseFloat(localStorage.getItem('thai_speed') || '1.0'),
  };

  /* ===== LocalStorage ===== */
  function loadFavorites() {
    try {
      return JSON.parse(localStorage.getItem('thai_favs') || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveFavorites() {
    localStorage.setItem('thai_favs', JSON.stringify(state.favorites));
    updateFavBadge();
  }

  function toggleFav(id) {
    const idx = state.favorites.indexOf(id);
    if (idx > -1) {
      state.favorites.splice(idx, 1);
      showToast('已取消收藏');
    } else {
      state.favorites.push(id);
      showToast('⭐ 已收藏');
    }
    saveFavorites();
    // 更新所有收藏按钮状态
    document.querySelectorAll(`[data-fav="${id}"]`).forEach(btn => {
      btn.classList.toggle('active', state.favorites.includes(id));
    });
  }

  function isFav(id) {
    return state.favorites.includes(id);
  }

  function updateFavBadge() {
    const badge = document.getElementById('fav-badge');
    if (state.favorites.length > 0) {
      badge.textContent = state.favorites.length;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  /* ===== Toast ===== */
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  /* ===== 音频播放 ===== */
  let currentUtterance = null;
  let thaiVoice = null;
  let currentAudioEl = null;        // HTML5 Audio 元素（自定义音频）
  let audioManifest = null;          // manifest.json 清单
  const audioCache = {};             // 自动检测缓存: { id: true/false }

  function loadVoices() {
    const voices = speechSynthesis.getVoices();
    thaiVoice = voices.find(v => v.lang === 'th-TH') || voices.find(v => v.lang.startsWith('th'));
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
  }

  // 启动时加载音频清单
  function loadAudioManifest() {
    fetch('audio/manifest.json')
      .then(r => {
        if (!r.ok) throw new Error('no manifest');
        return r.json();
      })
      .then(data => {
        audioManifest = data;
        const count = Object.keys(data).length;
        console.log('[音频] 已加载清单，共', count, '个自定义音频');
        // 清单加载后重新渲染当前页面，刷新"真人发音"标记
        if (count > 0) {
          const route = state.currentRoute;
          if (route === 'home') renderHome();
          else if (route === 'category') renderCategoryPage(state.currentCategory);
          else if (route === 'search' && state.searchQuery) performSearch(state.searchQuery);
          else if (route === 'favorites') renderFavoritesPage();
        }
      })
      .catch(() => {
        audioManifest = {};
        console.log('[音频] 无 manifest.json，将使用自动检测模式');
      });
  }

  // 判断某个句子是否有自定义音频（全部预生成了 MP3）
  function hasCustomAudio(id) {
    return true;
  }

  // 获取音频路径
  function getAudioPath(id) {
    var dir = state.voiceGender === 'male' ? 'audio/male/' : 'audio/';
    if (audioManifest && audioManifest[id]) {
      var val = audioManifest[id];
      return dir + val;
    }
    return dir + id + '.mp3';
  }

  function playAudio(id) {
    const sentence = SENTENCES.find(s => s.id === id);
    if (!sentence) return;

    // 如果正在播放同一个，停止
    if (state.currentPlayingId === id) {
      stopAudio();
      return;
    }

    // 停止之前的播放
    stopAudio();

    // 所有句子都有预生成的 MP3 音频文件 (audio/{id}.mp3)
    // 直接同步播放，保持用户手势链（移动端必须）
    playCustomAudio(id);
  }

  // 尝试检测自定义音频是否存在，然后播放
  function tryDetectAndPlay(id, sentence) {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = getAudioPath(id);

    let resolved = false;

    // 超时保护：1.5 秒内没加载到就回退 TTS
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        audioCache[id] = false;
        playTTS(id, sentence);
      }
    }, 1500);

    audio.oncanplay = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      audioCache[id] = true;
      playCustomAudio(id);
    };

    audio.onerror = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      audioCache[id] = false;
      playTTS(id, sentence);
    };

    audio.load();
  }

  // 播放自定义音频文件
  function playCustomAudio(id) {
    const audio = new Audio();
    audio.src = getAudioPath(id);
    audio.playbackRate = state.playbackSpeed;

    audio.onplay = () => {
      state.currentPlayingId = id;
      updatePlayButton(id, true);
    };

    audio.onended = () => {
      state.currentPlayingId = null;
      updatePlayButton(id, false);
    };

    audio.onerror = () => {
      state.currentPlayingId = null;
      updatePlayButton(id, false);
      // 回退到浏览器 TTS
      const sentence = SENTENCES.find(s => s.id === id);
      if (sentence) playTTS(id, sentence);
    };

    currentAudioEl = audio;
    audio.play().catch(() => {
      // 移动端可能需要用户交互，尝试 TTS 回退
      const sentence = SENTENCES.find(s => s.id === id);
      if (sentence) playTTS(id, sentence);
    });
  }

  // 播放 TTS（浏览器语音合成）
  function playTTS(id, sentence) {
    if (!('speechSynthesis' in window)) {
      showToast('当前浏览器不支持语音播放');
      return;
    }

    if (!thaiVoice) {
      loadVoices();
    }

    const utterance = new SpeechSynthesisUtterance(sentence.thai);
    utterance.lang = 'th-TH';
    utterance.rate = 0.75;
    utterance.pitch = 1.0;
    if (thaiVoice) {
      utterance.voice = thaiVoice;
    }

    utterance.onstart = () => {
      state.currentPlayingId = id;
      updatePlayButton(id, true);
    };

    utterance.onend = () => {
      state.currentPlayingId = null;
      updatePlayButton(id, false);
    };

    utterance.onerror = () => {
      state.currentPlayingId = null;
      updatePlayButton(id, false);
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
  }

  function stopAudio() {
    // 停止 TTS
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
    }
    // 停止自定义音频
    if (currentAudioEl) {
      currentAudioEl.pause();
      currentAudioEl = null;
    }
    if (state.currentPlayingId) {
      updatePlayButton(state.currentPlayingId, false);
      state.currentPlayingId = null;
    }
  }

  /* ===== 性别切换 ===== */
  function setVoiceGender(gender) {
    stopAudio();
    state.voiceGender = gender;
    localStorage.setItem('thai_gender', gender);
    showToast(gender === 'male' ? '👨 已切换男声' : '👩 已切换女声');
    updateGenderToggles();
  }

  function toggleHeaderGender() {
    setVoiceGender(state.voiceGender === 'male' ? 'female' : 'male');
  }

  function updateGenderToggles() {
    var isMale = state.voiceGender === 'male';
    document.querySelectorAll('.gender-toggle').forEach(btn => {
      btn.classList.toggle('male', isMale);
      var label = btn.querySelector('.gender-toggle__label');
      if (label) label.textContent = isMale ? '👨 男声' : '👩 女声';
    });
  }

  /* ===== 播放速度调节 ===== */
  function setPlaybackSpeed(speed) {
    state.playbackSpeed = speed;
    localStorage.setItem('thai_speed', speed.toString());
    // 实时更新正在播放的音频速度
    if (currentAudioEl) {
      currentAudioEl.playbackRate = speed;
    }
    // 更新速度按钮状态
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
    });
    var label = speed === 0.5 ? '0.5x 慢速' : speed === 0.75 ? '0.75x' : '1x 正常';
    showToast('🎵 ' + label);
  }

  /* ===== 大字提示卡 ===== */
  function showLargeCard(id) {
    var s = SENTENCES.find(function(x) { return x.id === id; });
    if (!s) return;

    var cat = CATEGORIES.find(function(c) { return c.id === s.cat; });
    var playing = state.currentPlayingId === id;

    var overlay = document.getElementById('largecard-overlay');
    var body = document.getElementById('largecard-body');

    var isMale = state.voiceGender === 'male';
    var speedLabel = state.playbackSpeed === 0.5 ? '0.5x' : state.playbackSpeed === 0.75 ? '0.75x' : '1x';

    body.innerHTML = `
      <div class="largecard__category">${cat ? cat.icon + ' ' + cat.title : ''}</div>
      <div class="largecard__thai">${s.thai}</div>
      <div class="largecard__cn">${s.cn}</div>
      <div class="largecard__pron">🔊 ${s.pron}</div>
      <div class="largecard__gender">${isMale ? '👨 男声用语' : '👩 女声用语'} · ${speedLabel}</div>
      <button class="largecard__play-btn ${playing ? 'playing' : ''}" onclick="playAudio(${s.id})">
        ${playing ? audioWaves() + ' 播放中...' : ICONS.volume + ' 点击播放'}
      </button>
      <div class="largecard__speed-row">
        <span class="largecard__speed-label">语速</span>
        <button class="speed-btn ${state.playbackSpeed === 0.5 ? 'active' : ''}" data-speed="0.5" onclick="setPlaybackSpeed(0.5)">0.5x</button>
        <button class="speed-btn ${state.playbackSpeed === 0.75 ? 'active' : ''}" data-speed="0.75" onclick="setPlaybackSpeed(0.75)">0.75x</button>
        <button class="speed-btn ${state.playbackSpeed === 1.0 ? 'active' : ''}" data-speed="1.0" onclick="setPlaybackSpeed(1.0)">1x</button>
      </div>
      <button class="largecard__close-text" onclick="closeLargeCard()">点击关闭</button>
    `;

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLargeCard() {
    document.getElementById('largecard-overlay').classList.remove('active');
    document.body.style.overflow = '';
  }

  function closeLargeCardOnOverlay(e) {
    if (e.target === document.getElementById('largecard-overlay')) {
      closeLargeCard();
    }
  }

  function updatePlayButton(id, playing) {
    // 卡片上的小播放按钮
    document.querySelectorAll(`[data-play="${id}"]`).forEach(btn => {
      btn.classList.toggle('playing', playing);
      const icon = btn.querySelector('.play-icon');
      const waves = btn.querySelector('.audio-waves');
      if (icon && waves) {
        icon.style.display = playing ? 'none' : 'block';
        waves.classList.toggle('active', playing);
      }
    });
    // 弹窗内的大播放按钮
    const modalPlayBtn = document.querySelector('#modal-body .modal__play-btn');
    if (modalPlayBtn) {
      modalPlayBtn.classList.toggle('playing', playing);
      if (playing) {
        modalPlayBtn.innerHTML = audioWaves() + ' 播放中...';
      } else {
        modalPlayBtn.innerHTML = ICONS.volume + ' 点击播放泰语发音';
      }
    }
    // 大字卡内的播放按钮
    const largeCardPlayBtn = document.querySelector('#largecard-body .largecard__play-btn');
    if (largeCardPlayBtn) {
      largeCardPlayBtn.classList.toggle('playing', playing);
      if (playing) {
        largeCardPlayBtn.innerHTML = audioWaves() + ' 播放中...';
      } else {
        largeCardPlayBtn.innerHTML = ICONS.volume + ' 点击播放';
      }
    }
  }

  /* ===== SVG 图标 ===== */
  const ICONS = {
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    heartFill: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg>',
    volume: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
    share: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  };

  function audioWaves() {
    return '<span class="audio-waves"><span></span><span></span><span></span><span></span></span>';
  }

  /* ===== 路由 ===== */
  function navigate(route, params) {
    params = params || {};
    stopAudio();
    closeModal();

    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // 更新底部导航
    document.querySelectorAll('.bottom-nav__item').forEach(item => {
      item.classList.toggle('active', item.dataset.nav === route);
    });

    state.currentRoute = route;

    switch (route) {
      case 'home':
        document.getElementById('page-home').classList.add('active');
        window.scrollTo(0, 0);
        break;
      case 'category':
        state.currentCategory = params.id;
        state.filters = { diff: 'all', tone: 'all' };
        renderCategoryPage(params.id);
        document.getElementById('page-category').classList.add('active');
        window.scrollTo(0, 0);
        break;
      case 'search':
        document.getElementById('page-search').classList.add('active');
        renderSearchPage();
        setTimeout(() => document.getElementById('search-input').focus(), 100);
        break;
      case 'favorites':
        document.getElementById('page-favorites').classList.add('active');
        renderFavoritesPage();
        window.scrollTo(0, 0);
        break;
    }
  }

  /* ===== 首页渲染 ===== */
  function renderHome() {
    const container = document.getElementById('home-categories');
    let html = '<div class="section-title"><span class="section-title__icon">📚</span> 学习分类<span class="section-title__count">' + CATEGORIES.length + ' 个分类</span></div>';
    html += '<div class="category-grid">';

    CATEGORIES.forEach(cat => {
      const count = SENTENCES.filter(s => s.cat === cat.id).length;
      html += `
        <div class="category-card" onclick="navigate('category', { id: '${cat.id}' })">
          <div class="category-card__icon" style="background: ${cat.bg};">${cat.icon}</div>
          <div class="category-card__title">${cat.title}</div>
          <div class="category-card__desc">${cat.desc}</div>
          <div class="category-card__count" style="color: ${cat.color};">📝 ${count} 句</div>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  }

  function scrollToCategories() {
    const el = document.getElementById('home-categories');
    if (el) {
      const offset = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: offset, behavior: 'smooth' });
    }
  }

  /* ===== 分类页渲染 ===== */
  function renderCategoryPage(catId) {
    const cat = CATEGORIES.find(c => c.id === catId);
    if (!cat) return;

    const sentences = SENTENCES.filter(s => s.cat === catId);

    document.getElementById('category-title').textContent = cat.icon + ' ' + cat.title;
    document.getElementById('category-subtitle').textContent = cat.desc + ' · 共 ' + sentences.length + ' 句';

    // 渲染筛选条
    renderFilterBar(sentences);

    // 渲染句子列表
    renderCategorySentences(catId);
  }

  function renderFilterBar(sentences) {
    const diffs = ['all', '入门', '常用', '进阶'];
    const tones = ['all', '礼貌', '可爱', '日常', '温柔'];

    const diffLabels = { all: '全部', '入门': '入门', '常用': '常用', '进阶': '进阶' };
    const toneLabels = { all: '全部', '礼貌': '礼貌', '可爱': '可爱', '日常': '日常', '温柔': '温柔' };

    const diffContainer = document.getElementById('filter-difficulty');
    diffContainer.innerHTML = diffs.map(d =>
      `<span class="chip ${state.filters.diff === d ? 'active' : ''}" onclick="setFilter('diff', '${d}')">${diffLabels[d]}</span>`
    ).join('');

    const toneContainer = document.getElementById('filter-tone');
    toneContainer.innerHTML = tones.map(t =>
      `<span class="chip ${state.filters.tone === t ? 'active' : ''}" onclick="setFilter('tone', '${t}')">${toneLabels[t]}</span>`
    ).join('');
  }

  function setFilter(type, value) {
    state.filters[type] = value;
    renderCategoryPage(state.currentCategory);
  }

  function renderCategorySentences(catId) {
    let sentences = SENTENCES.filter(s => s.cat === catId);

    if (state.filters.diff !== 'all') {
      sentences = sentences.filter(s => s.diff === state.filters.diff);
    }
    if (state.filters.tone !== 'all') {
      sentences = sentences.filter(s => s.tone === state.filters.tone);
    }

    const container = document.getElementById('category-sentences');

    if (sentences.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🔍</div>
          <div class="empty-state__title">没有符合条件的句子</div>
          <div class="empty-state__desc">试试切换其他筛选条件吧</div>
        </div>
      `;
      return;
    }

    container.innerHTML = sentences.map(s => renderSentenceCard(s)).join('');
  }

  /* ===== 句子卡片渲染 ===== */
  function renderSentenceCard(s) {
    const favActive = isFav(s.id) ? 'active' : '';
    const playing = state.currentPlayingId === s.id ? 'playing' : '';
    const customAudio = hasCustomAudio(s.id);

    return `
      <div class="sentence-card" onclick="openModal(${s.id})">
        <div class="sentence-card__header">
          <div class="sentence-card__thai" onclick="event.stopPropagation(); openModal(${s.id})">${s.thai}</div>
          <div class="sentence-card__actions">
            <button class="icon-btn icon-btn--play ${playing}" data-play="${s.id}"
              onclick="event.stopPropagation(); playAudio(${s.id})"
              title="播放发音">
              <span class="play-icon">${ICONS.play}</span>
              ${audioWaves()}
            </button>
            <button class="icon-btn icon-btn--card" 
              onclick="event.stopPropagation(); showLargeCard(${s.id})"
              title="放大给对方看">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
            </button>
            <button class="icon-btn icon-btn--fav ${favActive}" data-fav="${s.id}"
              onclick="event.stopPropagation(); toggleFav(${s.id})"
              title="收藏">
              ${isFav(s.id) ? ICONS.heartFill : ICONS.heart}
            </button>
          </div>
        </div>
        <div class="sentence-card__cn">${s.cn}</div>
        <div class="sentence-card__pron">${s.pron}</div>
        <div class="sentence-card__scene">📍 ${s.scene}</div>
        <div class="sentence-card__tags">
          ${customAudio ? '<span class="tag tag--audio">🔊 可点读</span>' : ''}
          <span class="tag tag--diff-${s.diff}">${s.diff}</span>
          <span class="tag tag--tone-${s.tone}">${s.tone}</span>
          ${s.gender !== 'neutral' ? `<span class="tag tag--scene">${s.gender === 'female' ? '👩 女生用语' : '👨 男生用语'}</span>` : ''}
          ${s.tags.map(t => `<span class="tag tag--scene">#${t}</span>`).join('')}
        </div>
      </div>
    `;
  }

  /* ===== 搜索页 ===== */
  function renderSearchPage() {
    // 热门搜索建议
    const suggestions = ['你好', '谢谢', '多少钱', '点餐', '打车', '租房', '看病', '买单', '砍价', '你好帅'];
    document.getElementById('suggestion-chips').innerHTML = suggestions.map(s =>
      `<span class="suggestion-chip" onclick="quickSearch('${s}')">${s}</span>`
    ).join('');

    if (!state.searchQuery) {
      document.getElementById('search-results').innerHTML = '';
      return;
    }

    performSearch(state.searchQuery);
  }

  function quickSearch(term) {
    document.getElementById('search-input').value = term;
    state.searchQuery = term;
    performSearch(term);
  }

  function performSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      document.getElementById('search-results').innerHTML = '';
      document.getElementById('search-suggestions').style.display = 'block';
      return;
    }

    document.getElementById('search-suggestions').style.display = 'none';

    const results = SENTENCES.filter(s => {
      return s.cn.toLowerCase().includes(q) ||
             s.thai.toLowerCase().includes(q) ||
             s.pron.toLowerCase().includes(q) ||
             s.scene.toLowerCase().includes(q) ||
             s.tags.some(t => t.toLowerCase().includes(q)) ||
             s.diff.toLowerCase().includes(q) ||
             s.tone.toLowerCase().includes(q);
    });

    const container = document.getElementById('search-results');

    if (results.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🤔</div>
          <div class="empty-state__title">没有找到相关句子</div>
          <div class="empty-state__desc">试试搜索"拍照""表白""加油"等关键词</div>
        </div>
      `;
      return;
    }

    let html = `<div class="section-title"><span class="section-title__icon">📋</span> 搜索结果<span class="section-title__count">${results.length} 句</span></div>`;
    html += '<div class="sentence-list">';
    html += results.map(s => renderSentenceCard(s)).join('');
    html += '</div>';
    container.innerHTML = html;
  }

  /* ===== 收藏页 ===== */
  function renderFavoritesPage() {
    const favSentences = state.favorites
      .map(id => SENTENCES.find(s => s.id === id))
      .filter(Boolean);

    document.getElementById('fav-count').textContent = `共 ${favSentences.length} 句`;

    const container = document.getElementById('favorites-content');

    if (favSentences.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">⭐</div>
          <div class="empty-state__title">还没有收藏任何句子</div>
          <div class="empty-state__desc">点击句子卡片上的爱心就能收藏啦</div>
          <button class="btn btn--primary mt-16" onclick="navigate('home')">去逛逛</button>
        </div>
      `;
      return;
    }

    let html = '<div class="sentence-list">';
    html += favSentences.map(s => renderSentenceCard(s)).join('');
    html += '</div>';
    container.innerHTML = html;
  }

  /* ===== 详情弹窗 ===== */
  function openModal(id) {
    const s = SENTENCES.find(x => x.id === id);
    if (!s) return;

    const cat = CATEGORIES.find(c => c.id === s.cat);
    const favActive = isFav(s.id) ? 'active' : '';
    const playing = state.currentPlayingId === s.id ? 'playing' : '';
    const isMale = state.voiceGender === 'male';

    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div class="modal__thai">${s.thai}</div>
      <div class="modal__cn">${s.cn}</div>
      <div class="modal__pron">🔊 ${s.pron}</div>

      <div class="modal__controls">
        <div class="modal__control-group">
          <span class="modal__control-label">声音</span>
          <button class="gender-toggle ${isMale ? 'male' : ''}" onclick="setVoiceGender('${isMale ? 'female' : 'male'}'); openModal(${s.id})">
            <span class="gender-toggle__label">${isMale ? '👨 男声' : '👩 女声'}</span>
          </button>
        </div>
        <div class="modal__control-group">
          <span class="modal__control-label">语速</span>
          <div class="speed-row">
            <button class="speed-btn ${state.playbackSpeed === 0.5 ? 'active' : ''}" data-speed="0.5" onclick="setPlaybackSpeed(0.5)">0.5x</button>
            <button class="speed-btn ${state.playbackSpeed === 0.75 ? 'active' : ''}" data-speed="0.75" onclick="setPlaybackSpeed(0.75)">0.75x</button>
            <button class="speed-btn ${state.playbackSpeed === 1.0 ? 'active' : ''}" data-speed="1.0" onclick="setPlaybackSpeed(1.0)">1x</button>
          </div>
        </div>
      </div>

      <button class="modal__play-btn ${playing}" onclick="playAudio(${s.id})">
        ${state.currentPlayingId === s.id
          ? `${audioWaves()} 播放中...`
          : `${ICONS.volume} 点击播放泰语发音`}
      </button>

      <button class="modal__largecard-btn" onclick="showLargeCard(${s.id})">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
        放大给对方看
      </button>

      <div class="modal__info">
        <div class="modal__info-row">
          <div class="modal__info-label">场景</div>
          <div class="modal__info-value">📍 ${s.scene}</div>
        </div>
        <div class="modal__info-row">
          <div class="modal__info-label">分类</div>
          <div class="modal__info-value">${cat ? cat.icon + ' ' + cat.title : ''}</div>
        </div>
        <div class="modal__info-row">
          <div class="modal__info-label">难度</div>
          <div class="modal__info-value"><span class="tag tag--diff-${s.diff}">${s.diff}</span></div>
        </div>
        <div class="modal__info-row">
          <div class="modal__info-label">语气</div>
          <div class="modal__info-value"><span class="tag tag--tone-${s.tone}">${s.tone}</span></div>
        </div>
        <div class="modal__info-row">
          <div class="modal__info-label">性别</div>
          <div class="modal__info-value">${s.gender === 'female' ? '👩 女生用语（ค่ะ）' : s.gender === 'male' ? '👨 男生用语（ครับ）' : '中性表达'}</div>
        </div>
        <div class="modal__info-row">
          <div class="modal__info-label">标签</div>
          <div class="modal__tags">${s.tags.map(t => `<span class="tag tag--scene">#${t}</span>`).join('')}</div>
        </div>
      </div>

      <div class="modal__actions">
        <button class="modal__action-btn modal__action-btn--fav ${favActive}" onclick="toggleFav(${s.id})">
          ${isFav(s.id) ? ICONS.heartFill : ICONS.heart}
          ${isFav(s.id) ? '已收藏' : '收藏'}
        </button>
        <button class="modal__action-btn modal__action-btn--fav" onclick="shareSentence(${s.id})">
          ${ICONS.share} 分享
        </button>
      </div>
    `;

    document.getElementById('modal-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    document.body.style.overflow = '';
    // 音频继续在后台播放，卡片上的按钮会显示播放状态
  }

  function closeModalOnOverlay(e) {
    if (e.target === document.getElementById('modal-overlay')) {
      closeModal();
    }
  }

  function shareSentence(id) {
    const s = SENTENCES.find(x => x.id === id);
    if (!s) return;

    const text = `${s.thai}\n${s.cn}\n🔊 ${s.pron}\n📍 ${s.scene}\n\n— 活人泰语点读卡 🇹🇭`;

    if (navigator.share) {
      navigator.share({ title: '泰语点读卡', text: text }).catch(() => {});
    } else {
      // 复制到剪贴板
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('已复制到剪贴板 📋');
        }).catch(() => {
          showToast('复制失败，请手动复制');
        });
      } else {
        showToast('当前浏览器不支持分享');
      }
    }
  }

  /* ===== 搜索输入监听 ===== */
  function initSearchInput() {
    const input = document.getElementById('search-input');
    let timer = null;

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.searchQuery = this.value;
        performSearch(this.value);
      }, 200);
    });

    // 回车搜索
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        this.blur();
      }
    });
  }

  /* ===== 全局暴露 ===== */
  window.navigate = navigate;
  window.playAudio = playAudio;
  window.toggleFav = toggleFav;
  window.setFilter = setFilter;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.closeModalOnOverlay = closeModalOnOverlay;
  window.shareSentence = shareSentence;
  window.quickSearch = quickSearch;
  window.scrollToCategories = scrollToCategories;
  window.setVoiceGender = setVoiceGender;
  window.toggleHeaderGender = toggleHeaderGender;
  window.setPlaybackSpeed = setPlaybackSpeed;
  window.showLargeCard = showLargeCard;
  window.closeLargeCard = closeLargeCard;
  window.closeLargeCardOnOverlay = closeLargeCardOnOverlay;

  /* ===== 初始化 ===== */
  function init() {
    renderHome();
    updateFavBadge();
    initSearchInput();
    loadAudioManifest();
    updateGenderToggles();

    // 检查语音支持
    if (!('speechSynthesis' in window)) {
      console.warn('当前浏览器不支持语音合成 API');
    }
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
