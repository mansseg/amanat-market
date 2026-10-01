/**
 * ==========================================================================
 * АМАНАТ МАРКЕТ — СОВРЕМЕННЫЙ ИНТЕРАКТИВНЫЙ ДВИЖОК САЙТА (APP.JS)
 * ==========================================================================
 * - Синхронизация в реальном времени с Google Таблицей (CSV)
 * - Локальный кэш (мгновенная загрузка даже при нестабильной связи)
 * - Умная фильтрация по категориям, брендам и поиску
 * - Выдвижная корзина (Drawer) с трекером бесплатной доставки
 * - Автогенерация накладной для WhatsApp и Telegram с данными клиента
 * - Модальное окно быстрого просмотра и админ-панель
 */

// Конфигурация источников данных
const CONFIG = {
    SHEETS_CSV_URL: 'https://docs.google.com/spreadsheets/d/1AQPDlp3Wh2rz21Ra1ltDpEDy9ocSO_elskJYx8ONr8s/export?format=csv',
    FREE_DELIVERY_THRESHOLD: 1000, // Порог бесплатной доставки в рублях
    STANDARD_DELIVERY_FEE: 150,    // Стоимость при заказе меньше порога
    CACHE_KEY_PRODUCTS: 'amanat_cached_products_v2',
    CACHE_KEY_TIMESTAMP: 'amanat_cache_timestamp_v2',
    CACHE_TTL_MS: 15 * 60 * 1000,  // 15 минут актуальности кэша
    WHATSAPP_PHONE: '77077974406',
    TELEGRAM_BOT: 'Amanating_bot',
    ADMIN_USER: 'amanat06.ru',
    ADMIN_PASS: 'amanat06.ru.amanat06.ru'
};

// Глобальное реактивное состояние приложения
const state = {
    products: [],
    filteredProducts: [],
    cart: [], // { id, name, brand, category, price, image, quantity }
    activeCategory: 'all',
    activeBrand: 'all',
    searchQuery: '',
    sortBy: 'default',
    isAdminLoggedIn: false
};

// ==========================================================================
// ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ DOM
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initLocalCart();
    initEventListeners();
    initHeroLiveSearch();
    loadCatalogData();
});

// ==========================================================================
// ЗАГРУЗКА И СИНХРОНИЗАЦИЯ ДАННЫХ (GOOGLE SHEETS + CACHE)
// ==========================================================================

/**
 * Загрузка каталога с многоуровневым кэшированием
 */
async function loadCatalogData(forceRefresh = false) {
    const grid = document.getElementById('productsGrid');

    // 1. Попытка мгновенного рендера из кэша
    const cachedData = localStorage.getItem(CONFIG.CACHE_KEY_PRODUCTS);
    const cachedTime = localStorage.getItem(CONFIG.CACHE_KEY_TIMESTAMP);
    const isCacheValid = cachedTime && (Date.now() - parseInt(cachedTime) < CONFIG.CACHE_TTL_MS);

    if (cachedData && !forceRefresh) {
        try {
            state.products = JSON.parse(cachedData);
            applyFiltersAndRender();
            updateCatalogCounters();
            console.log('⚡ Каталог загружен из локального кэша:', state.products.length, 'товаров');
        } catch (e) {
            console.warn('Ошибка чтения кэша, выполняем сетевой запрос:', e);
        }
    }

    // 2. Если кэша нет или принудительное обновление — показываем скелетон
    if (state.products.length === 0) {
        renderSkeletons();
    }

    // 3. Фоновый или прямой сетевой запрос к Google Sheets
    try {
        const response = await fetch(CONFIG.SHEETS_CSV_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
        
        const csvText = await response.text();
        const parsedProducts = parseCSVToProducts(csvText);

        if (parsedProducts && parsedProducts.length > 0) {
            state.products = parsedProducts;
            // Обновляем кэш
            localStorage.setItem(CONFIG.CACHE_KEY_PRODUCTS, JSON.stringify(parsedProducts));
            localStorage.setItem(CONFIG.CACHE_KEY_TIMESTAMP, Date.now().toString());

            applyFiltersAndRender();
            updateCatalogCounters();
            console.log('✅ Данные успешно синхронизированы с Google Таблицей:', state.products.length, 'товаров');
        } else {
            throw new Error('Пустые данные в Google Таблице');
        }
    } catch (err) {
        console.error('Не удалось загрузить данные из сети:', err);
        // Если вообще нет товаров (ни кэша, ни сети) — подключаем встроенный аварийный набор
        if (state.products.length === 0) {
            loadFallbackData();
            showToast('Загружен оффлайн-каталог товаров', 'info');
        }
    }
}

/**
 * Парсер CSV с поддержкой кавычек и спецсимволов
 */
function parseCSVToProducts(csv) {
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const idIdx = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    const brandIdx = headers.indexOf('brand');
    const catIdx = headers.indexOf('category');
    const priceIdx = headers.indexOf('price');
    const imgIdx = headers.indexOf('image');

    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (!row || row.length === 0 || !row[nameIdx]) continue;

        const id = parseInt(row[idIdx]) || i;
        const name = (row[nameIdx] || '').trim();
        const brand = (row[brandIdx] || 'Amanat').trim();
        const category = (row[catIdx] || 'other').trim();
        const price = parseInt(row[priceIdx]) || 0;
        const image = (row[imgIdx] || '').trim();

        result.push({
            id,
            name,
            brand,
            category,
            price,
            image: image || generatePlaceholderImg(brand)
        });
    }

    return result;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Резервный набор товаров на случай обрыва связи
 */
function loadFallbackData() {
    state.products = [
        { id: 1, name: "АВС 1.5 кг белое", brand: "ABC", category: "laundry", price: 188, image: "https://mansseg.github.io/amanat-market/images/abc-1.5kg-white.jpg" },
        { id: 2, name: "АВС 3 кг цветное", brand: "ABC", category: "laundry", price: 331, image: "https://mansseg.github.io/amanat-market/images/abc-3kg-color.jpg" },
        { id: 3, name: "Ариэль 6 кг белое", brand: "Ariel", category: "laundry", price: 881, image: "https://mansseg.github.io/amanat-market/images/ariel-6kg-white.jpg" },
        { id: 4, name: "Азелит Казан 600 мл", brand: "Grass", category: "kitchen", price: 138, image: "https://mansseg.github.io/amanat-market/images/azelit-kazan.jpg" },
        { id: 5, name: "Азелит Кухня антижир", brand: "Grass", category: "kitchen", price: 138, image: "https://mansseg.github.io/amanat-market/images/azelit-kuhnya.jpg" },
        { id: 6, name: "Аос 900 мл бальзам", brand: "Nefes", category: "dishes", price: 153, image: "https://mansseg.github.io/amanat-market/images/aos-900ml.jpg" },
        { id: 7, name: "Доместос 1 л белый дезинфекция", brand: "Domestos", category: "cleaning", price: 148, image: "https://mansseg.github.io/amanat-market/images/domestos-1l-white.jpg" },
        { id: 8, name: "Дегтярное мыло 140 г", brand: "Nevskaya", category: "hygiene", price: 49, image: "https://mansseg.github.io/amanat-market/images/degtyar-soap.jpg" }
    ];
    applyFiltersAndRender();
    updateCatalogCounters();
}

/**
 * Генератор стильной SVG-заглушки для товара без картинки
 */
function generatePlaceholderImg(label) {
    const text = (label || 'Amanat').substring(0, 14);
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
        <rect width="300" height="300" fill="#f2f5f2" rx="20"/>
        <circle cx="150" cy="120" r="45" fill="#d4af37" opacity="0.25"/>
        <text x="150" y="128" font-family="'Outfit', sans-serif" font-size="28" font-weight="bold" fill="#143e2c" text-anchor="middle">👑</text>
        <text x="150" y="200" font-family="'Plus Jakarta Sans', sans-serif" font-size="18" font-weight="700" fill="#1b533b" text-anchor="middle">${text}</text>
        <text x="150" y="224" font-family="'Plus Jakarta Sans', sans-serif" font-size="12" font-weight="600" fill="#788b7f" text-anchor="middle">100% ОРИГИНАЛ</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

// ==========================================================================
// ФИЛЬТРАЦИЯ, СОРТИРОВКА И ПОИСК
// ==========================================================================

function applyFiltersAndRender() {
    let result = [...state.products];

    // 1. Фильтр по категории
    if (state.activeCategory !== 'all') {
        result = result.filter(p => p.category === state.activeCategory);
    }

    // 2. Фильтр по бренду
    if (state.activeBrand !== 'all') {
        const targetBrand = state.activeBrand.toLowerCase();
        result = result.filter(p => p.brand.toLowerCase().includes(targetBrand) || p.name.toLowerCase().includes(targetBrand));
    }

    // 3. Поиск по строке (название + бренд)
    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase().trim();
        result = result.filter(p => 
            p.name.toLowerCase().includes(query) || 
            p.brand.toLowerCase().includes(query)
        );
    }

    // 4. Сортировка
    if (state.sortBy === 'price-asc') {
        result.sort((a, b) => a.price - b.price);
    } else if (state.sortBy === 'price-desc') {
        result.sort((a, b) => b.price - a.price);
    } else if (state.sortBy === 'name-asc') {
        result.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    state.filteredProducts = result;
    renderProductsGrid(result);

    // Обновляем статусную строку
    const countElem = document.getElementById('visibleProductsCount');
    if (countElem) countElem.textContent = result.length;

    const resetWrap = document.getElementById('resetFiltersWrap');
    const isFiltered = state.activeCategory !== 'all' || state.activeBrand !== 'all' || state.searchQuery !== '' || state.sortBy !== 'default';
    if (resetWrap) {
        resetWrap.style.display = isFiltered ? 'block' : 'none';
    }
}

function updateCatalogCounters() {
    const countAllElem = document.getElementById('count-all');
    if (countAllElem) countAllElem.textContent = state.products.length;

    // Обновляем счетчики в админке
    const adminTotal = document.getElementById('adminTotalProdsCount');
    if (adminTotal) adminTotal.textContent = state.products.length;
}

function resetAllFilters() {
    state.activeCategory = 'all';
    state.activeBrand = 'all';
    state.searchQuery = '';
    state.sortBy = 'default';

    // Сброс UI табов
    document.querySelectorAll('.cat-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'all');
    });

    // Сброс брендов
    document.querySelectorAll('.brand-chip').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.brand === 'all');
    });

    // Сброс поиска
    const heroInput = document.getElementById('heroSearchInput');
    if (heroInput) heroInput.value = '';
    const clearBtn = document.getElementById('heroClearSearchBtn');
    if (clearBtn) clearBtn.style.display = 'none';

    // Сброс сортировки
    const sortSelect = document.getElementById('catalogSortSelect');
    if (sortSelect) sortSelect.value = 'default';

    applyFiltersAndRender();
    showToast('Фильтры каталога сброшены');
}

// ==========================================================================
// РЕНДЕРИНГ КАРТОЧЕК ТОВАРОВ
// ==========================================================================

function renderProductsGrid(products) {
    const grid = document.getElementById('productsGrid');
    const emptyView = document.getElementById('noProductsFound');

    if (!grid) return;

    if (!products || products.length === 0) {
        grid.innerHTML = '';
        if (emptyView) emptyView.style.display = 'block';
        return;
    }

    if (emptyView) emptyView.style.display = 'none';

    grid.innerHTML = products.map(product => {
        const cartItem = state.cart.find(item => item.id === product.id);
        const qtyInCart = cartItem ? cartItem.quantity : 0;
        const categoryName = getCategoryTitle(product.category);

        return `
        <article class="product-card" id="product-${product.id}">
            <div class="product-card-media" onclick="openProductModal(${product.id})">
                <div class="card-badge-top">
                    <span class="badge-brand">${escapeHTML(product.brand)}</span>
                    <span class="badge-original"><i class="fa-solid fa-shield-halved"></i> Оригинал</span>
                </div>
                <img 
                    src="${escapeHTML(product.image)}" 
                    alt="${escapeHTML(product.name)}" 
                    class="product-card-img" 
                    loading="lazy"
                    onerror="this.onerror=null; this.src='${generatePlaceholderImg(product.brand)}';"
                >
                <button class="btn-quick-view" onclick="event.stopPropagation(); openProductModal(${product.id})" title="Быстрый просмотр">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </div>
            <div class="product-card-body">
                <div class="product-category-text">
                    <i class="fa-solid fa-tag"></i> ${categoryName}
                </div>
                <h3 class="product-card-title" onclick="openProductModal(${product.id})">
                    ${escapeHTML(product.name)}
                </h3>
                <div class="product-card-footer">
                    <div class="product-price-block">
                        <span class="price-main">${product.price.toLocaleString('ru-RU')} <span class="price-currency">₽</span></span>
                        <span class="price-note">В наличии</span>
                    </div>
                    <div class="product-card-action">
                        ${renderCartActionControl(product.id, qtyInCart)}
                    </div>
                </div>
            </div>
        </article>
        `;
    }).join('');
}

function renderCartActionControl(productId, quantity) {
    if (quantity > 0) {
        return `
        <div class="card-qty-stepper">
            <button class="stepper-btn" onclick="changeProductQty(${productId}, -1)" title="Уменьшить">−</button>
            <span class="stepper-val">${quantity}</span>
            <button class="stepper-btn" onclick="changeProductQty(${productId}, 1)" title="Увеличить">+</button>
        </div>
        `;
    } else {
        return `
        <button class="card-buy-btn" onclick="changeProductQty(${productId}, 1)">
            <i class="fa-solid fa-plus"></i> В корзину
        </button>
        `;
    }
}

function renderSkeletons() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="grid-skeleton-loading">
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
        </div>
    `;
}

function getCategoryTitle(catCode) {
    const map = {
        laundry: 'Стирка и порошки',
        dishes: 'Мытьё посуды',
        cleaning: 'Уборка',
        kitchen: 'Для кухни',
        hygiene: 'Гигиена и мыло'
    };
    return map[catCode] || 'Бытовая химия';
}

// ==========================================================================
// УПРАВЛЕНИЕ КОРЗИНОЙ И ЛОГИКА ЗАКАЗА
// ==========================================================================

function initLocalCart() {
    try {
        const savedCart = localStorage.getItem('amanat_cart_items');
        if (savedCart) {
            state.cart = JSON.parse(savedCart);
        }
    } catch (e) {
        state.cart = [];
    }
    syncCartUI();
}

function saveCartToStorage() {
    localStorage.setItem('amanat_cart_items', JSON.stringify(state.cart));
}

function changeProductQty(productId, delta) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    let cartItem = state.cart.find(i => i.id === productId);

    if (!cartItem && delta > 0) {
        cartItem = {
            id: product.id,
            name: product.name,
            brand: product.brand,
            category: product.category,
            price: product.price,
            image: product.image,
            quantity: 0
        };
        state.cart.push(cartItem);
    }

    if (cartItem) {
        cartItem.quantity += delta;
        if (cartItem.quantity <= 0) {
            state.cart = state.cart.filter(i => i.id !== productId);
            showToast(`«${product.name}» удален из корзины`);
        } else if (delta > 0 && cartItem.quantity === 1) {
            showToast(`«${product.name}» добавлен в корзину 🎉`);
        }
    }

    saveCartToStorage();
    syncCartUI();

    // Быстрое локальное обновление кнопки на карточке без полного ре-рендера сетки
    updateCardButtonOnly(productId);
}

function updateCardButtonOnly(productId) {
    const card = document.getElementById(`product-${productId}`);
    if (card) {
        const actionWrap = card.querySelector('.product-card-action');
        const cartItem = state.cart.find(i => i.id === productId);
        const qty = cartItem ? cartItem.quantity : 0;
        if (actionWrap) {
            actionWrap.innerHTML = renderCartActionControl(productId, qty);
        }
    }
}

function syncCartUI() {
    const totalCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Бейджи количества
    const headerCount = document.getElementById('cartBadgeCount');
    const mobBottomCount = document.getElementById('mobBottomCartCount');
    const headerTotal = document.getElementById('cartBtnTotal');
    const drawerSummary = document.getElementById('drawerItemsSummary');

    if (headerCount) headerCount.textContent = totalCount;
    if (mobBottomCount) mobBottomCount.textContent = totalCount;
    if (headerTotal) headerTotal.textContent = `${subtotal.toLocaleString('ru-RU')} ₽`;
    if (drawerSummary) drawerSummary.textContent = `${totalCount} ${pluralize(totalCount, ['товар', 'товара', 'товаров'])}`;

    // Трекер бесплатной доставки
    updateFreeDeliveryProgress(subtotal);

    // Рендер элементов в боковой шторке корзины
    renderCartDrawerItems(subtotal);
}

function updateFreeDeliveryProgress(subtotal) {
    const tracker = document.getElementById('freeDeliveryTracker');
    const msg = document.getElementById('freeDeliveryMessage');
    const bar = document.getElementById('freeDeliveryProgressBar');
    if (!tracker || !msg || !bar) return;

    if (subtotal === 0) {
        msg.innerHTML = `<i class="fa-solid fa-truck-fast"></i> Бесплатная доставка по Ингушетии от <strong>${CONFIG.FREE_DELIVERY_THRESHOLD.toLocaleString()} ₽</strong>`;
        bar.style.width = '0%';
        return;
    }

    if (subtotal >= CONFIG.FREE_DELIVERY_THRESHOLD) {
        msg.innerHTML = `🎉 <strong>Поздравляем!</strong> Доставка для вас <strong>БЕСПЛАТНО</strong>`;
        bar.style.width = '100%';
        bar.style.background = 'linear-gradient(90deg, #1c8e54, #25d366)';
    } else {
        const left = CONFIG.FREE_DELIVERY_THRESHOLD - subtotal;
        const percent = Math.min(100, Math.round((subtotal / CONFIG.FREE_DELIVERY_THRESHOLD) * 100));
        msg.innerHTML = `<i class="fa-solid fa-truck-fast"></i> До бесплатной доставки осталось всего <strong>${left.toLocaleString()} ₽</strong>`;
        bar.style.width = `${percent}%`;
        bar.style.background = 'linear-gradient(90deg, var(--gold-primary), var(--emerald-600))';
    }
}

function renderCartDrawerItems(subtotal) {
    const list = document.getElementById('cartItemsList');
    const emptyView = document.getElementById('emptyCartView');
    const footerView = document.getElementById('cartFooterView');
    const subtotalElem = document.getElementById('cartSubtotalAmount');
    const grandTotalElem = document.getElementById('cartGrandTotal');
    const deliveryElem = document.getElementById('cartDeliveryAmount');

    if (!list) return;

    if (state.cart.length === 0) {
        list.innerHTML = '';
        if (emptyView) list.appendChild(emptyView);
        if (emptyView) emptyView.style.display = 'block';
        if (footerView) footerView.style.display = 'none';
        return;
    }

    if (emptyView) emptyView.style.display = 'none';
    if (footerView) footerView.style.display = 'block';

    const isFreeDelivery = subtotal >= CONFIG.FREE_DELIVERY_THRESHOLD;
    const deliveryCost = isFreeDelivery ? 0 : CONFIG.STANDARD_DELIVERY_FEE;
    const grandTotal = subtotal + deliveryCost;

    if (subtotalElem) subtotalElem.textContent = `${subtotal.toLocaleString('ru-RU')} ₽`;
    if (deliveryElem) {
        deliveryElem.textContent = isFreeDelivery ? 'Бесплатно' : `${CONFIG.STANDARD_DELIVERY_FEE} ₽`;
        deliveryElem.className = isFreeDelivery ? 'text-success' : '';
    }
    if (grandTotalElem) grandTotalElem.textContent = `${grandTotal.toLocaleString('ru-RU')} ₽`;

    list.innerHTML = state.cart.map(item => `
        <div class="cart-item-row" id="cart-item-${item.id}">
            <img 
                src="${escapeHTML(item.image)}" 
                alt="${escapeHTML(item.name)}" 
                class="cart-item-thumb"
                onerror="this.onerror=null; this.src='${generatePlaceholderImg(item.brand)}';"
            >
            <div class="cart-item-details">
                <h4 class="cart-item-name">${escapeHTML(item.name)}</h4>
                <span class="cart-item-unit-price">${item.price.toLocaleString('ru-RU')} ₽ / шт.</span>
                <div class="cart-item-controls">
                    <div class="card-qty-stepper">
                        <button class="stepper-btn" onclick="changeProductQty(${item.id}, -1)">−</button>
                        <span class="stepper-val">${item.quantity}</span>
                        <button class="stepper-btn" onclick="changeProductQty(${item.id}, 1)">+</button>
                    </div>
                    <span class="cart-item-subtotal">${(item.price * item.quantity).toLocaleString('ru-RU')} ₽</span>
                </div>
            </div>
            <button class="btn-remove-item" onclick="removeProductCompletely(${item.id})" title="Удалить">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `).join('');
}

function removeProductCompletely(productId) {
    state.cart = state.cart.filter(item => item.id !== productId);
    saveCartToStorage();
    syncCartUI();
    updateCardButtonOnly(productId);
    showToast('Товар удален из корзины');
}

function confirmClearCart() {
    if (confirm('Вы уверены, что хотите полностью очистить корзину?')) {
        state.cart = [];
        saveCartToStorage();
        syncCartUI();
        // Сбрасываем кнопки на всех отображаемых карточках
        document.querySelectorAll('.product-card').forEach(card => {
            const id = parseInt(card.id.replace('product-', ''));
            updateCardButtonOnly(id);
        });
        showToast('Корзина полностью очищена');
    }
}

// ==========================================================================
// ОФОРМЛЕНИЕ ЗАКАЗА В МЕССЕНДЖЕРЫ (WHATSAPP И TELEGRAM)
// ==========================================================================

function handleCheckout(messenger) {
    if (state.cart.length === 0) {
        showToast('Ваша корзина пуста. Выберите товары в каталоге!', 'error');
        return;
    }

    const name = (document.getElementById('orderCustomerName')?.value || '').trim();
    const phone = (document.getElementById('orderCustomerPhone')?.value || '').trim();
    const city = document.getElementById('orderCustomerCity')?.value || 'Назрань';
    const address = (document.getElementById('orderCustomerAddress')?.value || '').trim();

    const subtotal = state.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const isFreeDelivery = subtotal >= CONFIG.FREE_DELIVERY_THRESHOLD;
    const deliveryText = isFreeDelivery ? 'БЕСПЛАТНО' : `${CONFIG.STANDARD_DELIVERY_FEE} ₽`;
    const grandTotal = isFreeDelivery ? subtotal : subtotal + CONFIG.STANDARD_DELIVERY_FEE;

    // Формируем аккуратную накладную
    let message = `🌟 *НОВЫЙ ЗАКАЗ — АМАНАТ МАРКЕТ*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (name) message += `👤 *Покупатель:* ${name}\n`;
    if (phone) message += `📞 *Телефон:* ${phone}\n`;
    message += `📍 *Город доставки:* ${city}\n`;
    if (address) message += `🏠 *Адрес / ориентир:* ${address}\n`;
    
    message += `\n📦 *Состав заказа:*\n`;
    state.cart.forEach((item, index) => {
        const itemTotal = (item.price * item.quantity).toLocaleString('ru-RU');
        message += `${index + 1}. ${item.name} — ${item.quantity} шт. × ${item.price} ₽ = ${itemTotal} ₽\n`;
    });

    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `💰 *Сумма товаров:* ${subtotal.toLocaleString('ru-RU')} ₽\n`;
    message += `🚚 *Доставка по Ингушетии:* ${deliveryText}\n`;
    message += `💵 *ИТОГО К ОПЛАТЕ:* ${grandTotal.toLocaleString('ru-RU')} ₽\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `✅ *Гарантия:* Проверка защитного QR-кода при получении курьеру.\n`;
    message += `Просьба подтвердить наличие и время доставки.`;

    const encodedText = encodeURIComponent(message);

    if (messenger === 'whatsapp') {
        const waUrl = `https://wa.me/${CONFIG.WHATSAPP_PHONE}?text=${encodedText}`;
        window.open(waUrl, '_blank');
        showToast('Накладная сформирована! Переход в WhatsApp...', 'success');
    } else if (messenger === 'telegram') {
        const tgUrl = `https://t.me/${CONFIG.TELEGRAM_BOT}?text=${encodedText}`;
        window.open(tgUrl, '_blank');
        showToast('Накладная сформирована! Переход в Telegram...', 'success');
    }
}

// ==========================================================================
// МОДАЛЬНЫЕ ОКНА И ШТОРКИ
// ==========================================================================

function toggleCartDrawer(open) {
    const drawer = document.getElementById('cartDrawer');
    const overlay = document.getElementById('cartOverlay');
    if (!drawer || !overlay) return;

    if (open) {
        drawer.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        drawer.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function openProductModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const modalBackdrop = document.getElementById('productModalBackdrop');
    const content = document.getElementById('quickViewContent');
    if (!modalBackdrop || !content) return;

    const cartItem = state.cart.find(i => i.id === product.id);
    const qtyInCart = cartItem ? cartItem.quantity : 0;

    content.innerHTML = `
        <div class="quick-view-layout">
            <div class="quick-view-img-wrap">
                <img 
                    src="${escapeHTML(product.image)}" 
                    alt="${escapeHTML(product.name)}" 
                    class="quick-view-img"
                    onerror="this.onerror=null; this.src='${generatePlaceholderImg(product.brand)}';"
                >
            </div>
            <div class="quick-view-info">
                <span class="modal-brand-badge">${escapeHTML(product.brand)}</span>
                <h2 class="modal-title-huge">${escapeHTML(product.name)}</h2>
                <div class="modal-price-huge">${product.price.toLocaleString('ru-RU')} ₽</div>
                <ul class="modal-features-list">
                    <li><i class="fa-solid fa-circle-check"></i> 100% Заводской оригинальный состав</li>
                    <li><i class="fa-solid fa-circle-check"></i> Защитный QR-код для проверки партии</li>
                    <li><i class="fa-solid fa-circle-check"></i> Безопасно для детей и аллергиков</li>
                    <li><i class="fa-solid fa-circle-check"></i> Оплата только после осмотра при курьере</li>
                </ul>
                <div style="margin-top: 1rem;">
                    <div id="modal-cart-action-${product.id}">
                        ${renderCartActionControl(product.id, qtyInCart)}
                    </div>
                </div>
            </div>
        </div>
    `;

    modalBackdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeProductModal(event) {
    if (event.target.id === 'productModalBackdrop') {
        closeProductModalDirect();
    }
}

function closeProductModalDirect() {
    const modalBackdrop = document.getElementById('productModalBackdrop');
    if (modalBackdrop) modalBackdrop.classList.remove('active');
    document.body.style.overflow = '';
}

// ==========================================================================
// АДМИН-ПАНЕЛЬ
// ==========================================================================

function openAdminModal() {
    const backdrop = document.getElementById('adminModalBackdrop');
    if (backdrop) {
        backdrop.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeAdminModal(event) {
    if (event.target.id === 'adminModalBackdrop') {
        closeAdminModalDirect();
    }
}

function closeAdminModalDirect() {
    const backdrop = document.getElementById('adminModalBackdrop');
    if (backdrop) backdrop.classList.remove('active');
    document.body.style.overflow = '';
}

function handleAdminLogin() {
    const user = (document.getElementById('adminUsernameInput')?.value || '').trim();
    const pass = (document.getElementById('adminPasswordInput')?.value || '').trim();

    if (user === CONFIG.ADMIN_USER && pass === CONFIG.ADMIN_PASS) {
        state.isAdminLoggedIn = true;
        document.getElementById('adminLoginForm').style.display = 'none';
        document.getElementById('adminDashboardView').style.display = 'block';
        showToast('Авторизация успешна!', 'success');
    } else {
        alert('Неверный логин или пароль администратора!');
    }
}

function handleAdminLogout() {
    state.isAdminLoggedIn = false;
    document.getElementById('adminLoginForm').style.display = 'block';
    document.getElementById('adminDashboardView').style.display = 'none';
    closeAdminModalDirect();
    showToast('Вы вышли из системы');
}

function forceReloadProductsFromSheets() {
    showToast('Синхронизация с Google Таблицей...');
    loadCatalogData(true);
}

// ==========================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И ОБРАБОТЧИКИ СОБЫТИЙ
// ==========================================================================

function initEventListeners() {
    // Открытие корзины
    document.getElementById('cartOpenBtn')?.addEventListener('click', () => toggleCartDrawer(true));

    // Мобильное меню
    document.getElementById('burgerToggleBtn')?.addEventListener('click', () => {
        document.getElementById('mobileNavDrawer')?.classList.add('open');
    });
    document.getElementById('closeMobileNavBtn')?.addEventListener('click', closeMobileNav);

    // Кнопка поиска в шапке
    document.getElementById('searchTriggerBtn')?.addEventListener('click', () => {
        const input = document.getElementById('heroSearchInput');
        if (input) {
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => input.focus(), 300);
        }
    });

    // Фильтры категорий
    document.getElementById('categoryTabs')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.cat-pill');
        if (!btn) return;
        document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeCategory = btn.dataset.category || 'all';
        applyFiltersAndRender();
    });

    // Фильтры брендов
    document.getElementById('brandChips')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.brand-chip');
        if (!btn) return;
        document.querySelectorAll('.brand-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeBrand = btn.dataset.brand || 'all';
        applyFiltersAndRender();
    });

    // Сортировка
    document.getElementById('catalogSortSelect')?.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        applyFiltersAndRender();
    });

    // Админка в футере
    document.getElementById('openAdminModalBtn')?.addEventListener('click', openAdminModal);
}

function initHeroLiveSearch() {
    const input = document.getElementById('heroSearchInput');
    const clearBtn = document.getElementById('heroClearSearchBtn');
    if (!input) return;

    input.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = state.searchQuery ? 'block' : 'none';
        applyFiltersAndRender();
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            state.searchQuery = '';
            clearBtn.style.display = 'none';
            applyFiltersAndRender();
            input.focus();
        });
    }
}

function focusAndSearchCatalog() {
    scrollToSection('catalog');
}

function scrollToSection(id) {
    const elem = document.getElementById(id);
    if (elem) {
        elem.scrollIntoView({ behavior: 'smooth' });
    }
}

function closeMobileNav() {
    document.getElementById('mobileNavDrawer')?.classList.remove('open');
}

function filterCategoryByCode(catCode) {
    state.activeCategory = catCode;
    document.querySelectorAll('.cat-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.category === catCode);
    });
    applyFiltersAndRender();
    scrollToSection('catalog');
}

function showToast(text, type = 'normal') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    
    let icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--danger)"></i>';
    if (type === 'info') icon = '<i class="fa-solid fa-circle-info"></i>';

    toast.innerHTML = `${icon} <span>${escapeHTML(text)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pluralize(n, forms) {
    let num = Math.abs(n) % 100;
    let n1 = num % 10;
    if (num > 10 && num < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
}
