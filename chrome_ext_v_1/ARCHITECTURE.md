# Архитектура Spins Logger

Этот документ фиксирует текущую архитектуру расширения в ее нынешнем виде. Это не план рефакторинга, а снимок того, как проект устроен сейчас.

## 1. Назначение проекта

`Spins Logger` — это Chrome Extension на Manifest V3 для:

- трекинга рулеточных столов и последних выпавших чисел
- хранения состояния отдельно по каждому tracked table
- отображения состояния и настроек в popup-интерфейсе
- автоматической постановки ставок по нескольким стратегиям
- применения ограничителей: balance stop и лимита входов по рынкам

Основная логика автоставок ориентирована на `play.livetables.io`, хотя часть общей tracking-инфраструктуры сейчас зарегистрирована шире.

## 2. Верхнеуровневая структура

### Сборка и упаковка

- `package.json`
  - Главная точка входа для node toolchain.
  - Содержит команды `clean`, `build`, `watch`.
- `package-lock.json`
  - Зафиксированное дерево npm-зависимостей.
- `build.js`
  - Собирает `src/*` в `dist/*` через `esbuild`.
  - Копирует статические файлы: `manifest.json`, `popup.html`, `popup.css`.
  - При необходимости запускает обфускацию итогового JS.
- `bump-version.js`
  - Перед сборкой увеличивает patch-версию в `src/manifest.json`.
- `README.md`
  - Общее описание проекта и сценариев использования.
- `dist/`, `dist_tmp/`, `builds/`
  - Артефакты сборки и выходные файлы.
- `node_modules/`
  - Установленные зависимости.

### Исходники

- `src/manifest.json`
  - Manifest расширения Chrome.
- `src/bg.js`
  - Background service worker и центральный координатор состояния.
- `src/content.js`
  - Content script, который работает на странице, читает DOM и поддерживает tracking.
- `src/popup.html`
  - Разметка popup-интерфейса.
- `src/popup.css`
  - Стили popup.
- `src/popup.js`
  - Точка сборки popup-приложения.
- `src/auto/*`
  - Runtime автоставок и модули стратегий.
- `src/popup/*`
  - Подмодули popup-интерфейса.
- `src/shared/*`
  - Общие helper-модули и модели данных, используемые в нескольких слоях.

## 3. Основные runtime-слои

### 3.1 Background service worker

Файл:

- `src/bg.js`

Зона ответственности:

- инициализация состояния расширения при install/startup
- хранение списка tracked tables
- хранение зеркала runtime-состояния по каждому tracked table
- управление lease-механикой по tab/frame
- прием сообщений от content scripts и popup
- нормализация и запись состояния в `chrome.storage.local`
- поддержка совместимости между legacy-глобальными ключами и per-table состоянием
- вычисление/обновление streak state для popup

Ключевые сущности этого слоя:

- список tracked tables
- `trackedTableStates`
- `trackedTableLeases`
- `selectedTrackedTableId`
- зеркала статуса, баланса, spin logs, bet logs
- производный streak state

Именно здесь реализована межвкладочная и межоконная координация через storage и tab/frame-aware leasing. Это и есть настоящая основа multi-window/multi-tab поведения.

### 3.2 Content runtime

Файл:

- `src/content.js`

Зона ответственности:

- работа в контексте страницы казино
- чтение title текущего стола
- поиск контейнера с последними spins
- извлечение истории выпавших чисел
- чтение текущего баланса со страницы
- управление lifecycle tracking-а через таймеры и reconnect-попытки
- отправка снимков состояния и событий в `bg.js`
- реакция на storage changes и сообщения из background
- page-specific действия: reconnect / re-enter / continue и подобные клики

Рабочая схема:

- определяет, относится ли текущая страница/фрейм к tracked table
- получает или обновляет lease через background worker
- периодически читает DOM и отправляет состояние в background
- сам popup не обновляет, а пишет в общий слой данных

### 3.3 Popup-приложение

Файлы:

- `src/popup.html`
- `src/popup.css`
- `src/popup.js`
- `src/popup/*`

Зона ответственности:

- чтение текущего состояния из `chrome.storage.local`
- управление tracked tables
- настройка стратегий автоставок и глобальных chips
- отображение статусов, dots, spin logs, bet logs и счетчиков
- экспорт и очистка логов
- управление toggle tracking-а и safety-настройками

Popup уже разбит на модули, но по факту собирается вручную через несколько специализированных файлов и один более крупный orchestration-слой.

### 3.4 Runtime автоставок

Файлы:

- `src/auto/engine.js`
- `src/auto/market-base.js`
- `src/auto/*.js`

Зона ответственности:

- предоставление общего движка автоставок в page context
- один общий mutex на последовательность кликов внутри документа
- вычисление effective chips и выбор chip-селекторов
- поддержка execution state по рынкам
- запуск strategy-specific trigger detection и step progression
- запись bet logs и статусов рынков

Важное замечание:

- `window.BET`, `window.MarketBase` и `window.__STRAT_*` используются как общий runtime-контракт между autoplay-модулями, загруженными в один и тот же page context.
- Это механизм обмена внутри одной страницы, а не механизм multi-window координации.

## 4. Жизненный цикл расширения

### Установка / запуск браузера

1. Chrome загружает `src/bg.js` как MV3 service worker.
2. `bg.js` нормализует сохраненное состояние и подписывается на сообщения и storage changes.

### Открытие страницы

1. Chrome внедряет `src/content.js`.
2. На `play.livetables.io` дополнительно внедряются autoplay-модули из `src/auto/*`.
3. `content.js` определяет текущий стол и начинает обмен состоянием с `bg.js`.
4. `engine.js` публикует `window.BET`.
5. `market-base.js` публикует `window.MarketBase`.
6. Каждая стратегия создает singleton `window.__STRAT_*` и подписывается на `chrome.storage.onChanged`.

### Открытие popup

1. Chrome открывает `popup.html`.
2. `popup.js` импортирует popup-модули и загружает текущее состояние из storage.
3. Модули рендерят tracked tables, logs, statuses, chips и market settings.
4. `popup/live.js` поддерживает live-обновление интерфейса через `chrome.storage.onChanged`.

## 5. Потоки данных

### 5.1 Tracking flow

1. `content.js` читает title стола, spins, баланс и page state.
2. `content.js` отправляет обновления в `bg.js`.
3. `bg.js` решает, какой tab/frame владеет lease данного tracked table.
4. `bg.js` записывает нормализованное состояние в `chrome.storage.local`.
5. Popup-модули реагируют на storage changes и перерисовываются.

### 5.2 Auto-bet flow

1. Popup записывает конфиг рынка и enabled-флаг в storage.
2. Стратегия видит это изменение через `chrome.storage.onChanged`.
3. Стратегия читает spin logs и runtime state, обычно из tracked-table-состояния.
4. Стратегия определяет trigger, step, reset, waiting или win/loss.
5. Стратегия вызывает `BET.tryPlace(...)` из `engine.js`.
6. `engine.js` сериализует клики через общий mutex и ставит chips/targets.
7. Стратегия обновляет execution state, статус и bet logs.
8. Popup обновляется через storage changes.

### 5.3 Focused table flow

1. Пользователь выбирает tracked table в popup.
2. Его id сохраняется в `selectedTrackedTableId`.
3. Popup-модули логов, статусов и dots используют состояние именно выбранного tracked table.
4. Часть стратегий также опирается на focused/selected table при выборе нужного execution map или статусного контекста.

## 6. Модель хранения данных

Основная общая шина проекта — это `chrome.storage.local`. Через нее взаимодействуют popup, content scripts, autoplay-стратегии и background worker.

### Основные tracking-ключи

- `trackingEnabled`
  - Глобальный toggle tracking-а.
- `trackerStatus`
  - Общий legacy/global статус tracking-а.
- `spinLogs`
  - Legacy/global spin logs как fallback.
- `betLogs`
  - Legacy/global bet logs как fallback.
- `currentBalance`
  - Legacy/global balance как fallback.
- `streakState`
  - Legacy/global производное streak-состояние.

### Ключи tracked tables

- `trackedTables`
  - Список tracked tables, которыми управляет пользователь.
- `trackedTableStates`
  - Главное runtime-зеркало по каждому tracked table.
  - Внутри table state могут лежать: title, matched title, leader, status, balance, spin logs, bet logs, streak state.
- `trackedTableLeases`
  - Lease ownership по table id и tab/frame.
- `selectedTrackedTableId`
  - Текущий focus в popup.
- `trackedTableBetLogsByTable`
  - Отдельная карта bet logs по table id.
- `uiTrackedTablesOpen`
  - Popup-only состояние раскрытых/закрытых карточек.

### Глобальные конфиги

- `abGlobalChips`
  - Общий шаблон chip selector и список chip values.
- `abBalanceStopConfig`
  - Настройки min/max balance stop.
- `abBalanceStopState`
  - Runtime-состояние срабатывания balance stop.
- `abMaxEntriesPerMarket`
  - Глобальный лимит входов в рынок.
- `entryCounters`
  - Текущие счетчики входов по рынкам.

### Ключи конфигов рынков

- `abDozensConfig`
- `abRowsConfig`
- `abSixConfig`
- `abThreesConfig`
- `abLowHighConfig`
- `abEvenOddConfig`
- `abColorsConfig`
- `abSectorsConfig`
- `abNeighborsConfig`
- `abAntiDozensConfig`
- `abAntiRowsConfig`
- `abNumbersConfig`

Они хранят market-specific конфиг: streak/gap trigger, progression steps, include-zero, auto-continue и другие параметры конкретного рынка.

### Флаги включения рынков

- `autoBettingDozensEnabled`
- `autoBettingRowsEnabled`
- `autoBettingSixEnabled`
- `autoBettingThreesEnabled`
- `autoBettingLowHighEnabled`
- `autoBettingEvenOddEnabled`
- `autoBettingColorsEnabled`
- `autoBettingSectorsEnabled`
- `autoBettingNeighborsEnabled`
- `autoBettingAntiDozensEnabled`
- `autoBettingAntiRowsEnabled`
- `autoBettingNumbersEnabled`

### Статусы рынков

- `bettingStatusDozens`
- `bettingStatusRows`
- `bettingStatusSix`
- `bettingStatusThrees`
- `bettingStatusLowHigh`
- `bettingStatusEvenOdd`
- `bettingStatusColors`
- `bettingStatusSectors`
- `bettingStatusNeighbors`
- `bettingStatusAntiDozens`
- `bettingStatusAntiRows`
- `bettingStatusNumbers`

Это маленькие UI-объекты состояния, которые popup использует для отображения текущего статуса рынка.

### Ключи execution state

Сейчас в проекте используются как одиночные exec-объекты, так и per-table exec maps:

- `betExecDozens`
- `betExecDozensByTable`
- `betExecRows`
- `betExecRowsByTable`
- `betExecSix`
- `betExecThrees`
- `betExecThreesByTable`
- `betExecLowHigh`
- `betExecLowHighByTable`
- `betExecEvenOdd`
- `betExecEvenOddByTable`
- `betExecColors`
- `betExecColorsByTable`
- `betExecSectors`
- `betExecNeighbors`
- `betExecAntiDozens`
- `betExecAntiDozensByTable`
- `betExecAntiRows`
- `betExecAntiRowsByTable`
- `betExecNumbers`

То есть в кодовой базе одновременно присутствуют:

- legacy single exec state
- exec state в формате map-by-table

Оба варианта учитываются вспомогательной логикой, например в `src/shared/entry-limit.js`.

## 7. Карта popup-модулей

### Composition root

- `src/popup.js`
  - Главный bootstrap popup.
  - Загружает стартовые данные и подтягивает `popup/live.js` для реактивных обновлений.
  - Также содержит логику balance-stop UI и часть focused-table синхронизации.

### DOM binding

- `src/popup/dom.js`
  - Центральный реестр `document.getElementById(...)` для popup.
  - Используется как общая карта элементов для остальных popup-модулей.

### Базовые popup-хелперы

- `src/popup/utils.js`
  - Небольшие storage-wrapper-функции и форматирование.
- `src/popup/toggle.js`
  - Чтение и запись глобального `trackingEnabled`.
- `src/popup/status.js`
  - Формирование верхнего status pill по tracked-table-состояниям.

### UI tracked tables

- `src/popup/tables.js`
  - Главный UI-модуль tracked tables.
  - Рендерит карточки столов, live state, spin/bet snapshots, custom chips, экспорт и remembered UI state.

### Spin и bet logs

- `src/popup/spin-logs.js`
  - Рендер focused spin logs, экспорт CSV, очистка логов, вычисление чисел near trigger.
- `src/popup/bet-logs.js`
  - Рендер focused bet logs, экспорт CSV, очистка bet logs, реакция на live-обновления.

### Markets и autoplay config

- `src/popup/markets.js`
  - Хранит ключи market config, default-конфиги, sanitize-логику, загрузку/сохранение market UI и reset wiring для toggle.
- `src/popup/steps-ui.js`
  - Рендер editable progression steps и чтение их обратно из DOM.
- `src/popup/init.js`
  - Вешает обработчики кнопок, autosave, save-all, entry-limit controls и другие UI-склейки между модулями.
- `src/popup/chips.js`
  - UI для глобальных chips.

### Домены / patterns

- `src/popup/domains.js`
  - Legacy UI для domain/pattern правил и re-register логики content scripts.

### Live-синхронизация

- `src/popup/live.js`
  - Центральный `chrome.storage.onChanged` listener для popup.
  - Проталкивает в уже открытый popup обновления логов, статусов и runtime-состояния.

### Визуализация streak

- `src/popup/streaks.js`
  - Держит в памяти latest spins и current streak state, рисует dots для trigger-визуализации рынков.

### Balance-stop UI

- `src/popup/balance-stop.js`
  - Выделенный UI-модуль для balance stop.
  - Часть той же фичи, которая дополнительно инициализируется из `popup.js`.

Примечание:

- В `popup.html` до сих пор есть hidden compatibility blocks для старых popup-модулей. Это значит, что popup уже частично мигрирован на новую структуру, но слой совместимости еще не убран.

## 8. Карта shared-модулей

- `src/shared/tracked-tables.js`
  - Общая модель tracked tables, sanitizers, formatting helpers, badge/status helpers и утилиты чтения table state.
- `src/shared/entry-limit.js`
  - Общая логика entry gate.
  - Может отключать рынок после достижения лимита, сбрасывать exec state и писать bet logs и в global, и в per-table storage.

## 9. Карта auto-runtime модулей

### Общий runtime

- `src/auto/engine.js`
  - Общий движок постановки ставок.
  - Публикует `window.BET`.
  - Содержит shared mutex, выбор chips, клик по target-узлам, загрузку effective chips, запись статусов и общие helper-функции.
- `src/auto/market-base.js`
  - Базовый класс для большинства стратегий.
  - Публикует `window.MarketBase`.
  - Содержит общую sanitize-логику конфига, enable/disable flow, запись статусов и базовую инициализацию.

### Стратегии на базе `MarketBase`

- `src/auto/dozens.js`
  - Триггер по повторяющейся дюжине, ставка на две другие дюжины.
  - Использует tracked-table state и ведет как single exec, так и by-table exec map.
- `src/auto/rows.js`
  - Триггер по повторяющемуся ряду, ставка на два других ряда.
- `src/auto/sixlines.js`
  - Триггер по six-line паттерну, ставка на complement six-lines.
- `src/auto/threes.js`
  - Стратегия по streets / тройкам.
- `src/auto/lowhigh.js`
  - Стратегия low/high.
- `src/auto/evenodd.js`
  - Стратегия even/odd.
- `src/auto/colors.js`
  - Стратегия red/black.
- `src/auto/sectors.js`
  - Секторная стратегия.
- `src/auto/anti-dozens.js`
  - Стратегия на отсутствующую дюжину / anti-dozens.
- `src/auto/anti-rows.js`
  - Стратегия на отсутствующий ряд / anti-rows.
- `src/auto/numbers.js`
  - Стратегия по числам с большим gap, то есть по "задержавшимся" номерам.

Типовой паттерн этих файлов:

- вычисление market index
- strategy-specific trigger detection
- чтение tracked-table logs/state
- ставка через `BET.tryPlace(...)`
- собственный `chrome.storage.onChanged` listener
- singleton в `window.__STRAT_*`

### Стратегии с более самостоятельной архитектурой

- `src/auto/combo.js`
  - Combo-рынок на связку dozen + row.
  - Содержит больше собственной inline-логики и менее унифицирован с `MarketBase`.
- `src/auto/neighbors.js`
  - Стратегия neighbors/racetrack.
  - Имеет собственный sanitize flow, собственную очередь, расчет покрытия и более отдельную механику постановки.

Оба файла входят в тот же autoplay-слой, но архитектурно более самостоятельны, чем остальные стратегии.

## 10. Модель состояний стратегии

Большинство стратегий живут в похожем state machine:

- `idle`
  - ожидание trigger condition в spin logs
- `armed`
  - trigger найден, шаг готов к постановке или уже активен
- `waiting`
  - промежуточное ожидание до strategy-specific условия
- `off`
  - рынок отключен из UI или остановлен guard-логикой

Типовой цикл:

1. Прочитать последние spin logs.
2. Найти повторяющийся / отсутствующий / overdue pattern.
3. Построить target set.
4. Войти в step 1 и поставить ставку.
5. На следующих spins определить win / loss / next step / reset.
6. Обновить storage status и bet logs.

## 11. Ограничители и safety-слой

### Balance stop

Файлы:

- `src/content.js`
- `src/popup.js`
- `src/popup/balance-stop.js`

Зона ответственности:

- чтение текущего баланса со страницы
- сравнение с min/max thresholds
- установка runtime stop state
- отражение stop state в popup

### Entry limit

Файлы:

- `src/shared/entry-limit.js`
- `src/popup/init.js`
- strategy-модули, которые используют entry gate

Зона ответственности:

- подсчет first-entry событий по рынкам
- запрет новых входов после достижения лимита
- отключение рынка и reset exec state
- запись поясняющего bet log

## 12. Текущий архитектурный стиль

Проект сейчас использует гибридный подход:

- MV3 background worker для межвкладочной координации
- content scripts для чтения DOM и page-side действий
- ES modules в popup и shared-слое
- IIFE-style runtime-модули для autoplay
- `window` globals как контракт интеграции внутри одной страницы
- `chrome.storage.local` как общая шина данных и событий между слоями

То есть в проекте одновременно существуют две основные модели интеграции:

- module imports в popup/shared/build toolchain
- global runtime wiring в autoplay/page context

## 13. Важные структурные особенности текущего состояния

Это не список изменений, а просто фиксация текущего состояния проекта:

- tracked-table state существует параллельно с legacy global state
- execution state существует и как одиночные объекты, и как per-table maps
- popup уже модульный, но все еще частично склеен через крупные manual binding-файлы
- autoplay-стратегии имеют общий паттерн, но пока не полностью унифицированы
- hidden compatibility markup все еще остается в `popup.html`
- `chrome.storage.onChanged` — один из главных механизмов интеграции почти между всеми слоями

## 14. Краткая ответственность основных файлов

- `src/manifest.json`
  - Описывает структуру расширения, permissions, popup, background и injected scripts.
- `src/bg.js`
  - Центральный cross-tab координатор и authority по tracked-table state.
- `src/content.js`
  - DOM-tracker и page-side runtime controller.
- `src/popup.js`
  - Bootstrap popup и верхнеуровневая композиция popup-фич.
- `src/popup/tables.js`
  - UI tracked tables и per-table operational view.
- `src/popup/markets.js`
  - Модель market config и popup-side загрузка/сохранение market settings.
- `src/popup/init.js`
  - Wiring popup-событий и UI glue code.
- `src/popup/live.js`
  - Live-синхронизация storage -> popup.
- `src/shared/tracked-tables.js`
  - Общая модель tracked tables и utility-функции.
- `src/shared/entry-limit.js`
  - Общая guard-логика лимита входов.
- `src/auto/engine.js`
  - Общий движок постановки ставок.
- `src/auto/market-base.js`
  - Базовое поведение для большинства стратегий.
- `src/auto/*.js`
  - Конкретные стратегии автоставок.

## 15. Рекомендуемый порядок чтения проекта

Если входить в проект с нуля, самый быстрый порядок чтения такой:

1. `src/manifest.json`
2. `src/bg.js`
3. `src/content.js`
4. `src/popup.js`
5. `src/shared/tracked-tables.js`
6. `src/popup/markets.js`
7. `src/auto/engine.js`
8. `src/auto/market-base.js`
9. одна репрезентативная стратегия, например `src/auto/dozens.js`
10. остальные стратегии по необходимости

Такой порядок лучше отражает реальную runtime-архитектуру проекта, чем попытка начать с popup UI.
