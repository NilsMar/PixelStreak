import { supabase, checkAuth, signOut } from './auth.js';

// State
let goals = [];
const actualCurrentYear = new Date().getFullYear();
let currentYear = actualCurrentYear;
const today = new Date();
today.setHours(0, 0, 0, 0);
let currentUser = null;

// DOM Elements
const goalsContainer = document.getElementById('goalsContainer');
const addGoalForm = document.getElementById('addGoalForm');
const goalInput = document.getElementById('goalInput');
const yearSelector = document.getElementById('yearSelector');
const themeToggle = document.getElementById('themeToggle');
const tooltip = document.getElementById('tooltip');
const logoutBtn = document.getElementById('logoutBtn');

// Initialize
async function init() {
    currentUser = await checkAuth();
    if (!currentUser) return;

    await loadGoals();
    loadTheme();
    renderYearSelector();
    renderGoals();
    setupEventListeners();
}

// Database Operations
async function loadGoals() {
    try {
        const { data, error } = await supabase
            .from('goals')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: true });

        if (error) throw error;
        goals = data || [];
    } catch (error) {
        console.error('Error loading goals:', error);
        alert('Failed to load goals. Please refresh the page.');
    }
}

async function saveGoal(goal) {
    try {
        const goalData = {
            user_id: currentUser.id,
            name: goal.name,
            days: goal.days || {},
            updated_at: new Date().toISOString(),
        };

        if (goal.id) {
            // Update existing goal
            const { error } = await supabase
                .from('goals')
                .update(goalData)
                .eq('id', goal.id);

            if (error) throw error;
        } else {
            // Insert new goal
            const { data, error } = await supabase
                .from('goals')
                .insert([goalData])
                .select()
                .single();

            if (error) throw error;
            goal.id = data.id;
        }
    } catch (error) {
        console.error('Error saving goal:', error);
        alert('Failed to save goal. Please try again.');
    }
}

async function deleteGoal(goalId) {
    try {
        const { error } = await supabase
            .from('goals')
            .delete()
            .eq('id', goalId);

        if (error) throw error;
    } catch (error) {
        console.error('Error deleting goal:', error);
        alert('Failed to delete goal. Please try again.');
    }
}

// Theme Management (still using localStorage for preference)
function loadTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.checked = theme === 'dark';
}

function saveTheme(theme) {
    localStorage.setItem('theme', theme);
}

// Year Selector
function renderYearSelector() {
    const years = [actualCurrentYear, actualCurrentYear + 1].filter(year => year >= 2026);
    yearSelector.innerHTML = years.map(year => `
        <button class="year-btn ${year === currentYear ? 'active' : ''}" data-year="${year}">
            ${year}
        </button>
    `).join('');
}

// Generate dates for a year
function getYearDates(year) {
    const dates = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    // Adjust to start from Sunday
    const firstDay = new Date(startDate);
    firstDay.setDate(firstDay.getDate() - firstDay.getDay());

    const current = new Date(firstDay);
    while (current <= endDate || current.getDay() !== 0) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

// Get weeks from dates
function getWeeks(dates) {
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
        weeks.push(dates.slice(i, i + 7));
    }
    return weeks;
}

// Format date as key
function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Format date for display
function formatDate(date) {
    const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Calculate month labels and positions
function getMonthLabels(weeks, year) {
    const months = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastMonth = -1;

    weeks.forEach((week, weekIndex) => {
        const firstDayOfWeek = week.find(d => d.getFullYear() === year && d.getMonth() !== lastMonth);
        if (firstDayOfWeek && firstDayOfWeek.getMonth() !== lastMonth) {
            lastMonth = firstDayOfWeek.getMonth();
            months.push({ name: monthNames[lastMonth], weekIndex });
        }
    });

    return months;
}

// Calculate stats for a goal
function calculateStats(goal) {
    const completed = Object.values(goal.days || {}).filter(v => v === 'completed').length;
    const missed = Object.values(goal.days || {}).filter(v => v === 'missed').length;
    const total = completed + missed;
    const streak = calculateStreak(goal);
    return { completed, missed, total, streak };
}

// Calculate current streak
function calculateStreak(goal) {
    let streak = 0;
    const current = new Date(today);

    while (true) {
        const key = dateKey(current);
        if (goal.days && goal.days[key] === 'completed') {
            streak++;
            current.setDate(current.getDate() - 1);
        } else {
            break;
        }
    }

    return streak;
}

// Render Goals
function renderGoals() {
    if (goals.length === 0) {
        goalsContainer.innerHTML = `
            <div class="empty-state">
                <h2>No goals yet</h2>
                <p>Add your first goal above to start tracking!</p>
            </div>
        `;
        return;
    }

    const dates = getYearDates(currentYear);
    const weeks = getWeeks(dates);
    const monthLabels = getMonthLabels(weeks, currentYear);

    goalsContainer.innerHTML = goals.map((goal, goalIndex) => {
        const stats = calculateStats(goal);

        return `
            <div class="goal-card" data-goal-index="${goalIndex}">
                <div class="goal-header">
                    <div>
                        <h3 class="goal-title" data-goal-index="${goalIndex}" contenteditable="false" spellcheck="false">${escapeHtml(goal.name)}</h3>
                        <div class="goal-stats">
                            ${stats.completed} completed · ${stats.missed} missed · ${stats.streak} day streak
                        </div>
                    </div>
                    <div class="goal-actions">
                        <button class="delete-goal" data-goal-index="${goalIndex}">Delete</button>
                    </div>
                </div>
                <div class="contribution-grid-wrapper">
                    <div class="contribution-grid">
                        <div class="grid-header">
                            ${renderMonthLabels(monthLabels, weeks.length)}
                        </div>
                        ${renderGridRows(weeks, goal, goalIndex)}
                    </div>
                </div>
                <div class="legend">
                    <span>Less</span>
                    <div class="legend-item">
                        <div class="legend-cell empty"></div>
                    </div>
                    <div class="legend-item">
                        <div class="legend-cell completed"></div>
                        <span>Completed</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-cell missed"></div>
                        <span>Missed</span>
                    </div>
                    <span>More</span>
                </div>
            </div>
        `;
    }).join('');
}

// Render month labels
function renderMonthLabels(monthLabels, totalWeeks) {
    let html = '';
    let currentPos = 0;

    monthLabels.forEach((month, index) => {
        const nextMonth = monthLabels[index + 1];
        const width = nextMonth
            ? (nextMonth.weekIndex - month.weekIndex) * 15
            : (totalWeeks - month.weekIndex) * 15;

        html += `<span class="month-label" style="width: ${width}px">${month.name}</span>`;
    });

    return html;
}

// Render grid rows
function renderGridRows(weeks, goal, goalIndex) {
    const dayLabels = ['', 'M', '', 'W', '', 'F', ''];

    return dayLabels.map((label, dayIndex) => `
        <div class="grid-row">
            <span class="day-label">${label}</span>
            <div class="cells-container">
                ${weeks.map((week, weekIndex) => {
                    const date = week[dayIndex];
                    if (!date) return '';

                    const key = dateKey(date);
                    const status = goal.days ? goal.days[key] : null;
                    const isToday = date.getTime() === today.getTime();
                    const isFuture = date > today;
                    const isCurrentYear = date.getFullYear() === currentYear;

                    let classes = ['cell'];
                    if (status === 'completed') classes.push('completed');
                    if (status === 'missed') classes.push('missed');
                    if (isToday) classes.push('today');
                    if (isFuture) classes.push('future');
                    if (!isCurrentYear) classes.push('other-year');

                    return `
                        <div class="${classes.join(' ')}"
                             data-date="${key}"
                             data-goal-index="${goalIndex}"
                             data-display-date="${formatDate(date)}"
                             ${isFuture ? 'data-future="true"' : ''}>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Save goal title after editing
async function saveGoalTitle(titleElement) {
    const goalIndex = parseInt(titleElement.dataset.goalIndex);
    const newName = titleElement.textContent.trim();

    // Validate
    if (!newName) {
        // Restore original value if empty
        titleElement.textContent = titleElement.dataset.originalValue;
    } else if (newName !== titleElement.dataset.originalValue) {
        // Save the new name
        goals[goalIndex].name = newName;
        await saveGoal(goals[goalIndex]);
    }

    // Make non-editable
    titleElement.contentEditable = 'false';
    delete titleElement.dataset.originalValue;
}

// Event Listeners
function setupEventListeners() {
    // Add goal form
    addGoalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = goalInput.value.trim();
        if (name) {
            const newGoal = { name, days: {} };
            await saveGoal(newGoal);
            goals.push(newGoal);
            renderGoals();
            goalInput.value = '';
        }
    });

    // Year selector
    yearSelector.addEventListener('click', (e) => {
        if (e.target.classList.contains('year-btn')) {
            currentYear = parseInt(e.target.dataset.year);
            renderYearSelector();
            renderGoals();
        }
    });

    // Theme toggle
    themeToggle.addEventListener('change', () => {
        const theme = themeToggle.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        saveTheme(theme);
    });

    // Logout button
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut();
            window.location.href = '/index.html';
        } catch (error) {
            console.error('Error signing out:', error);
            alert('Failed to sign out. Please try again.');
        }
    });

    // Cell clicks and delete buttons
    goalsContainer.addEventListener('click', async (e) => {
        // Handle goal title click to edit
        if (e.target.classList.contains('goal-title')) {
            const titleElement = e.target;
            const goalIndex = parseInt(titleElement.dataset.goalIndex);

            // Store original value in case of cancel
            titleElement.dataset.originalValue = titleElement.textContent;

            // Make editable
            titleElement.contentEditable = 'true';
            titleElement.focus();

            // Select all text
            const range = document.createRange();
            range.selectNodeContents(titleElement);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            return;
        }

        // Handle cell click
        if (e.target.classList.contains('cell') && !e.target.dataset.future) {
            const goalIndex = parseInt(e.target.dataset.goalIndex);
            const dateStr = e.target.dataset.date;

            if (!goals[goalIndex].days) {
                goals[goalIndex].days = {};
            }

            const currentStatus = goals[goalIndex].days[dateStr];

            // Cycle through: none -> completed -> missed -> none
            if (!currentStatus) {
                goals[goalIndex].days[dateStr] = 'completed';
            } else if (currentStatus === 'completed') {
                goals[goalIndex].days[dateStr] = 'missed';
            } else {
                delete goals[goalIndex].days[dateStr];
            }

            await saveGoal(goals[goalIndex]);
            renderGoals();
        }

        // Handle delete button
        if (e.target.classList.contains('delete-goal')) {
            const goalIndex = parseInt(e.target.dataset.goalIndex);
            if (confirm(`Are you sure you want to delete "${goals[goalIndex].name}"?`)) {
                await deleteGoal(goals[goalIndex].id);
                goals.splice(goalIndex, 1);
                renderGoals();
            }
        }
    });

    // Handle goal title editing
    goalsContainer.addEventListener('blur', async (e) => {
        if (e.target.classList.contains('goal-title') && e.target.contentEditable === 'true') {
            await saveGoalTitle(e.target);
        }
    }, true);

    goalsContainer.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('goal-title') && e.target.contentEditable === 'true') {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // Restore original value
                e.target.textContent = e.target.dataset.originalValue;
                e.target.contentEditable = 'false';
                delete e.target.dataset.originalValue;
            }
        }
    });

    // Tooltip
    goalsContainer.addEventListener('mouseover', (e) => {
        if (e.target.classList.contains('cell')) {
            const displayDate = e.target.dataset.displayDate;
            const status = e.target.classList.contains('completed') ? ' - Completed' :
                           e.target.classList.contains('missed') ? ' - Missed' : '';

            tooltip.textContent = displayDate + status;
            tooltip.classList.add('visible');
        }
    });

    goalsContainer.addEventListener('mousemove', (e) => {
        if (tooltip.classList.contains('visible')) {
            tooltip.style.left = e.pageX + 10 + 'px';
            tooltip.style.top = e.pageY - 30 + 'px';
        }
    });

    goalsContainer.addEventListener('mouseout', (e) => {
        if (e.target.classList.contains('cell')) {
            tooltip.classList.remove('visible');
        }
    });
}

// Initialize app
init();
