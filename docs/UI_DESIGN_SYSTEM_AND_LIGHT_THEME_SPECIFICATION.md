---
title: "Technical Specification: UI Design System & Whitish-Slate Light Theme"
date: 2026-09-28
tags:
  - specification
  - design-system
  - ui-ux
  - css-tokens
  - light-theme
  - accessibility
  - obsidian-vault
aliases:
  - UI Design System Spec
  - Light Theme Specification
---

# 🎨 Technical Specification: UI Design System & Whitish-Slate Light Theme

**Target System:** `azure-graph-mailer`  
**Author:** Antigravity Engineering  
**Status:** PRODUCTION IMPLEMENTED & DEPLOYED  
**Date:** September 28, 2026  
**Commit Reference:** `b0ae60e`, `e889816`

---

## 1. Goal & Architecture Overview

The **Azure Graph Mailer** user interface was redesigned from high-contrast legacy dark mode to a modern, clean, eye-friendly **whitish-slate light theme**. The interface prioritizes cognitive ease for editorial operators managing high-volume email pipelines (10,000+ daily dispatches) across long working hours without eye strain or glare.

### Core Objectives:
1. **Zero-Glare Cognitive Comfort:** Deep slate navy typography (`#0f172a`, `#475569`) on crisp white cards (`#ffffff`) and soft airy slate canvas (`#f1f5f9`).
2. **Native OS Dark-Mode Neutralization:** Preventing host operating systems (e.g., Windows 11 Dark Mode) and Chromium browser defaults from rendering native dropdown option menus with unreadable black styling.
3. **High-Density Information Architecture:** Clear spatial hierarchy with subtle borders (`#e2e8f0`), elevated card shadows, sticky table headers, and pastel status badge pills.
4. **Responsive Continuity:** Consistent light-mode styling across desktop monitors, slide-over inspection drawers, modal dialogs, and mobile bottom navigation bars.

---

## 2. Design Tokens & CSS Variable Matrix

The design system is centered in [`public/css/style.css`](file:///D:/projects/azure-graph-mailer/public/css/style.css) within the `:root` scope:

```css
:root {
  /* Force light color scheme on native browser widgets (scrollbars, date pickers, selects) */
  color-scheme: light;

  /* Surfaces & Backgrounds */
  --bg-main: #f1f5f9;        /* Soft airy slate background, zero glare */
  --bg-surface: #ffffff;     /* Pure white for top navigation, panels, drawers */
  --bg-card: #ffffff;        /* Pure white card container */
  --bg-card-hover: #f8fafc;  /* Subtle hover state tint */
  --bg-input: #ffffff;       /* Pure white form inputs and selects */

  /* Borders & Dividers */
  --border-color: #e2e8f0;   /* Clean light slate divider border */
  --border-subtle: #f1f5f9;  /* Minimalist inner table border */

  /* High-Contrast Glare-Free Typography */
  --text-primary: #0f172a;   /* Deep slate navy, crystal clear legibility */
  --text-secondary: #475569; /* Balanced slate gray for subheaders and labels */
  --text-muted: #94a3b8;     /* Soft slate captions and secondary metadata */

  /* Vibrant Accent Palette (Calibrated for Light Backgrounds) */
  --sky: #0284c7;            /* Ocean blue: primary actions, links, active state */
  --sky-hover: #0369a1;
  --sky-glow: rgba(2, 132, 199, 0.08);

  --emerald: #059669;        /* Forest emerald: success, delivered, active status */
  --emerald-subtle: #ecfdf5;

  --amber: #d97706;          /* Warm amber: scheduled hold, warnings, CDN alerts */
  --amber-subtle: #fffbeb;

  --rose: #e11d48;           /* Crimson rose: failed deliveries, danger buttons */
  --rose-subtle: #fff1f2;

  --purple: #7c3aed;         /* Royal violet: sub-batches, visual category */
  --purple-subtle: #faf5ff;

  /* Elevation Shadows */
  --shadow-card: 0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-hover: 0 4px 14px -2px rgba(15, 23, 42, 0.08), 0 2px 6px -1px rgba(15, 23, 42, 0.04);
}
```

---

## 3. The Dropdown & Form Control Problem & Resolution

### 3.1 The Incident: Dropdowns & Inputs Turning Black

During manual verification on Windows with OS Dark Mode enabled, users noticed that clicking on any `<select>` dropdown menu (e.g. template chooser, sender account pool, schedule mode) or focusing on inputs caused them to turn completely black.

### 3.2 Root Cause Analysis

Two independent issues compounded to cause the dark artifact:

```
[User Clicks <select>] 
         │
         ├──► 1. CSS :focus Pseudo-Class
         │       Previous style had:
         │       background-color: rgba(12, 18, 32, 0.95);  <-- Hardcoded Dark Navy/Black
         │
         └──► 2. OS Dark Mode Inheritance
                 Browsers (Chrome, Edge) check if page declares `color-scheme: light`.
                 In the absence of this rule, Windows OS Dark Mode forces native
                 <option> popups into operating system dark mode (black background).
```

### 3.3 The Resolution

1. **CSS `:focus` Rule Fixed**:
   Replaced the dark background with pure white and a crisp, subtle sky focus ring:
   ```css
   .form-input:focus,
   .form-select:focus,
   .form-textarea:focus {
     outline: none;
     border-color: var(--sky);
     box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
     background-color: #ffffff;
   }
   ```

2. **Native Color Scheme Declared**:
   Added `color-scheme: light;` directly to `:root`. This instructs the browser's native rendering engine to use light styling for all native popups, scrollbars, and date-time pickers.

3. **Explicit `<option>` & `<optgroup>` Tokens**:
   ```css
   select option,
   select optgroup {
     background-color: #ffffff;
     color: #0f172a;
   }
   ```

---

## 4. Component Design Specifications

### 4.1 Live Campaign Monitor Hero Card
* **Background:** Solid `#ffffff` (replaces legacy `linear-gradient` dark navy).
* **Border:** `1px solid rgba(2, 132, 199, 0.3)`.
* **Progress Bar Track:** `#e2e8f0` (clean light slate track ensuring the green/sky fill is clearly visible).
* **Actions:** Clean tactile buttons (`#btnMonitorPause`, `#btnMonitorResume`, `#btnMonitorCancel`).

### 4.2 High-Density Slide-Over Inspection Drawer
* **Backdrop:** `background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(4px);`.
* **Drawer Panel:** Solid `#ffffff` with a subtle elevation drop shadow (`box-shadow: -10px 0 35px rgba(15, 23, 42, 0.15);`).
* **Sticky Table Header:** `position: sticky; top: 0; background: #ffffff; box-shadow: 0 1px 0 var(--border-color);`.
* **Table Rows:** Zebra striping with `#ffffff` and `#f8fafc`, row hover at `#f1f5f9`.

### 4.3 Campaign Hierarchy (Parent & Child Batches)
* **Parent Header:** Solid white with chevron rotation transition.
* **Child Batches Container:** Light slate container `#f8fafc` with subtle divider `1px solid var(--border-color)`.
* **Row Hover:** `#f1f5f9`.

### 4.4 Status Badge Pills
Each status badge uses a high-contrast pastel background with deeply saturated text for crisp legibility:

| Status Badge Class | Background | Text Color | Use Case |
| :--- | :--- | :--- | :--- |
| `.badge-completed` | `#ecfdf5` | `#047857` | Sent / Delivered / Completed |
| `.badge-sending` | `#f0f9ff` | `#0369a1` | In-Transit / Currently Sending |
| `.badge-queued` | `#fffbeb` | `#b45309` | In Pipeline / Waiting Turn |
| `.badge-failed` | `#fff1f2` | `#be123c` | Failed Delivery / Error |
| `.badge-scheduled`| `#faf5ff` | `#6b21a8` | Target Time Hold / Staggered |

### 4.5 Mobile Bottom Navigation Bar (`.nav-tabs`)
* **Position:** Fixed at viewport bottom with safe-area padding: `padding-bottom: env(safe-area-inset-bottom, 0px);`.
* **Surface:** `rgba(255, 255, 255, 0.95)` with `backdrop-filter: blur(12px)`.
* **Dividers:** `border-top: 1px solid var(--border-color);`.
* **Active Indicator:** Light sky pill `rgba(56, 189, 248, 0.12)` with `color: var(--sky)`.

---

## 5. Verification Checklist

- [x] Hard refresh (**Ctrl + F5**) verifies pure whitish slate theme across all tabs.
- [x] Clicking any `<select>` dropdown menu retains pure white background without turning black.
- [x] Native `<option>` elements render with `#ffffff` background and `#0f172a` text on Windows OS dark mode.
- [x] Input textboxes, number inputs, and date pickers keep white backgrounds on focus.
- [x] Mobile bottom app bar renders clean translucent white glassmorphism.
- [x] Inspection slide-over drawer opens smoothly with crisp typography and readable delivery records.
