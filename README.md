# Rowing Calculator

A mobile-friendly rowing calculator, and a sister app to the [Watt Calculator](https://github.com/madooroy/WattCalculator) for cycling. Convert between pace and watts, solve for pace, time or distance, see your rowing power and heart rate zones, and look up Peloton's 10 pace-target levels, either exactly as Peloton sets them or with watts rounded to the nearest 5.

## Features

- **Pace ⇄ Watts**: convert a split per 500m to watts, or watts to a split, with 2K time, 30-minute distance and kJ per hour
- **Workout**: find pace from distance and time, time from distance and pace, or distance from time and pace, with average watts, kJ and calories
- **Zone badges**: shows the power zone (with IF and training load for workouts) and which Peloton effort band the pace falls in at your level
- **Power Zones**: five zones from your rowing FTP (Recovery, Easy, Moderate, Challenging, Max) in watts and pace, matched to Peloton's effort cues; suggests the closest Peloton level
- **Heart rate zones**: based on Max HR or Lactate Threshold HR, default or custom (same zones and rules as the Watt Calculator)
- **Peloton Levels**: all 10 levels with Low/Mid/High pace and watts for every effort band; choose **Peloton Exact** or **Rounded to 5W**
- **Print or save tables as images**
- **Works offline**: once opened with a connection, it opens and runs with no signal
- Remembers your inputs on your device; works in light and dark mode

## How the numbers work

- Pace and watts use the Concept2 formula used by most rowing monitors, including the SmartRow: `watts = 2.80 ÷ (seconds per meter)³`.
- **Rounded to 5W** rounds each Peloton target to the nearest 5 watts and recalculates the pace from the rounded watts, so pace and watts always match. Level 1 stays exact, because rounding its small numbers would make some Low and Mid values identical.
- A level's FTP is its Challenging midpoint. Power zones are 0–43%, 44–71%, 72–87%, 88–114% and 115%+ of FTP, which line up with the Peloton bands at the matching level. The same percentages work as custom power zones in intervals.icu.
- The app keeps its own saved settings and never reads or changes the Watt Calculator's, even when both are hosted on the same site.
- Calories assume about 1 kJ of work ≈ 1 kcal burned. Rowing monitors usually add a resting allowance, so they show more.

## Files

- `index.html`: page structure
- `styles.css`: styling
- `app.js`: calculations and interactivity
- `sw.js`: offline support (saves the app's files on the device)
- `vendor/html2canvas.min.js`: image library for Save Image (MIT license), bundled so it works offline

## Releasing an update

After changing any file, change `VERSION` at the top of `sw.js` (for example to today's date). Phones then download the new version in the background and show an "Update available" note; it also takes effect the next time the app is opened.
