(() => {
  const layer = document.getElementById("live-presence-layer");
  const countElement = document.getElementById("presence-count");
  const regions = new Map(
    Array.from(document.querySelectorAll("[data-presence-region]"))
      .map((element) => [element.dataset.presenceRegion, element]),
  );
  const cursors = new Map();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let countryNames = null;
  try {
    if (typeof Intl.DisplayNames === "function") {
      countryNames = new Intl.DisplayNames(["en"], { type: "region" });
    }
  } catch {
    countryNames = null;
  }
  const reconnectLimit = 15_000;

  let socket = null;
  let selfId = null;
  let publisherEnabled = false;
  let reconnectDelay = 1_000;
  let reconnectTimer = null;
  let moveTimer = null;
  let latestMove = null;
  let lastMoveSentAt = 0;
  const participants = new Map();

  if (!layer || !countElement) return;

  const clamp = (value) => Math.min(1, Math.max(0, value));

  const countryLabel = (country) => {
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) return "🌐";
    let name = country;
    try {
      name = countryNames?.of(country) || country;
    } catch {
      name = country;
    }
    const flag = String.fromCodePoint(
      ...country.split("").map((letter) => 127397 + letter.charCodeAt(0)),
    );
    return `${flag} ${name}`;
  };

  const identityLabel = (participant) => {
    const country = countryLabel(participant.country);
    const prefix = participant.country ? `${participant.animalEmoji} ` : "🌐 ";
    return `${prefix}${participant.adjective} ${participant.animal}${participant.country ? ` · ${country}` : ""}`;
  };

  const setOnlineCount = (online) => {
    if (!Number.isFinite(online) || online < 1) return;
    countElement.textContent = online === 1 ? "You're here" : `${online} people here now`;
  };

  const positionFor = (cursor) => {
    const region = regions.get(cursor.presenceRegion);
    if (!region) return null;
    const rect = region.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: window.scrollX + rect.left + clamp(cursor.x) * rect.width,
      y: window.scrollY + rect.top + clamp(cursor.y) * rect.height,
      viewportX: rect.left + clamp(cursor.x) * rect.width,
      viewportY: rect.top + clamp(cursor.y) * rect.height,
    };
  };

  const updateLabelPlacement = (cursor, position) => {
    const label = cursor.querySelector(".presence-label");
    if (!label) return;
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const rightOverflow = position.viewportX + 16 + width > window.innerWidth - 10;
    const leftOverflow = position.viewportX - 16 - width < 10;
    const bottomOverflow = position.viewportY + 16 + height > window.innerHeight - 10;
    const topOverflow = position.viewportY - 16 - height < 10;
    cursor.classList.toggle("presence-cursor--flip", rightOverflow && !leftOverflow);
    cursor.classList.toggle("presence-cursor--above", bottomOverflow && !topOverflow);
  };

  const placeCursor = (cursor) => {
    const position = positionFor(cursor.dataset);
    if (!position) {
      cursor.hidden = true;
      return;
    }
    cursor.hidden = false;
    cursor.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    updateLabelPlacement(cursor, position);
  };

  const removeCursor = (id) => {
    const cursor = cursors.get(id);
    if (!cursor) return;
    cursor.remove();
    cursors.delete(id);
  };

  const showCursor = (participant, active = false) => {
    if (!participant || participant.id === selfId || !participant.publisher) return;
    if (!regions.has(participant.region) || !Number.isFinite(participant.x) || !Number.isFinite(participant.y)) return;

    let cursor = cursors.get(participant.id);
    if (!cursor) {
      if (cursors.size >= 24) return;
      cursor = document.createElement("div");
      cursor.className = "presence-cursor";
      cursor.dataset.presenceId = participant.id;
      cursor.innerHTML = '<span class="presence-pointer" aria-hidden="true"></span><span class="presence-label"></span>';
      layer.appendChild(cursor);
      cursors.set(participant.id, cursor);
    }

    cursor.dataset.presenceRegion = participant.region;
    cursor.dataset.x = String(clamp(participant.x));
    cursor.dataset.y = String(clamp(participant.y));
    cursor._participant = { ...cursor._participant, ...participant };
    cursor.style.setProperty("--presence-color", participant.color || "#c54868");
    cursor.querySelector(".presence-label").textContent = identityLabel(participant);
    cursor.classList.toggle("is-active", active);
    placeCursor(cursor);

    if (active) {
      window.clearTimeout(cursor._fadeTimer);
      cursor._fadeTimer = window.setTimeout(() => cursor.classList.remove("is-active"), 2_500);
    }
  };

  const handleSnapshot = (message) => {
    setOnlineCount(message.online);
    cursors.forEach((cursor) => cursor.remove());
    cursors.clear();
    participants.clear();
    (Array.isArray(message.participants) ? message.participants : []).forEach((participant) => {
      participants.set(participant.id, participant);
      showCursor(participant);
    });
  };

  const handleMessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;

    if (message.type === "hello" && message.self) {
      selfId = message.self.id;
      publisherEnabled = Boolean(message.self.publisher);
      return;
    }
    if (message.type === "snapshot") {
      handleSnapshot(message);
      return;
    }
    if (message.type === "publisher") {
      publisherEnabled = message.enabled === true;
      return;
    }
    if (message.type === "join") {
      setOnlineCount(message.online);
      if (message.participant?.id) participants.set(message.participant.id, message.participant);
      showCursor(message.participant);
      return;
    }
    if (message.type === "move") {
      if (message.id === selfId) return;
      const participant = {
        ...(participants.get(message.id) || { id: message.id, publisher: true }),
        ...message,
        publisher: true,
      };
      participants.set(message.id, participant);
      showCursor(participant, true);
      return;
    }
    if (message.type === "leave") {
      setOnlineCount(message.online);
      participants.delete(message.id);
      removeCursor(message.id);
    }
  };

  const scheduleReconnect = () => {
    if (reconnectTimer || document.visibilityState === "hidden") return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectLimit);
  };

  const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/presence`);
    socket.addEventListener("open", () => {
      reconnectDelay = 1_000;
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", () => {
      socket = null;
      selfId = null;
      publisherEnabled = false;
      cursors.forEach((cursor) => cursor.remove());
      cursors.clear();
      participants.clear();
      scheduleReconnect();
    });
    socket.addEventListener("error", () => socket?.close());
  };

  const flushMove = () => {
    moveTimer = null;
    if (!latestMove || !publisherEnabled || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(latestMove));
    latestMove = null;
    lastMoveSentAt = Date.now();
  };

  const queueMove = (move) => {
    latestMove = move;
    if (moveTimer) return;
    const wait = Math.max(0, 100 - (Date.now() - lastMoveSentAt));
    moveTimer = window.setTimeout(flushMove, wait);
  };

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (document.visibilityState === "hidden" || !publisherEnabled) return;
    const target = event.target instanceof Element ? event.target.closest("[data-presence-region]") : null;
    const region = target?.dataset.presenceRegion;
    const regionElement = region ? regions.get(region) : null;
    if (!regionElement) return;
    const rect = regionElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    queueMove({
      type: "move",
      region,
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    });
  }, { passive: true });

  window.addEventListener("scroll", () => {
    cursors.forEach(placeCursor);
  }, { passive: true });
  window.addEventListener("resize", () => {
    cursors.forEach(placeCursor);
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !socket) connect();
  });

  connect();
})();
