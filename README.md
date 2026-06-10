# EPark Zone Audit Tool

Welcome to the **EPark Zone Audit Tool**. This is a simple, offline-friendly web application designed for parking operations team members walking on foot in the City of Edmonton. It helps inspectors track their progress, count parked cars, and log street blockages (impediments) in real time.

---

## The User Story

As a **field parking inspector walking on foot**, I want a tool that:
* Shows me a map of all parking zones in Edmonton.
* Shows my current location as I walk down the street.
* Automatically registers when I walk into a parking zone, chimes to let me know, and displays the correct form for that zone.
* Let's me easily verify that street signs match my records.
* Let's me quickly count parked cars and log blockages (like construction or police activity) with a few taps.
* Keeps my progress safe even if my battery dies or I close the browser.
* Let's me view visual charts of my work shift and download my data as a spreadsheet or sync it directly to a shared Google Sheet.

---

## User Workflow

When you start your shift, follow these simple steps:

1. **Open the Tool**: Open the website on your mobile phone or tablet.
2. **Turn on Audio Alerts**: Tap the **Enable Audio Tracker** button at the top. This allows the app to play sounds when you enter zones or forget to save your work.
3. **Locate Yourself**: Tap the **Locate Me** button to center the map on your current GPS position. You will see your position as a pulsing blue dot.
4. **Walk into a Parking Zone**: As you walk, the map will follow you. When you enter a zone boundary, the phone will play a pleasant bell chime, and the audit form will slide open on the right (on desktops) or bottom (on mobile).
5. **Verify Street Signage**: Look at the operating hours and location details displayed at the top of the form. Verify they match the physical signs on the street. If they do, check the **Confirm details match physical signage** box.
6. **Enter Counts & Blockages**:
   * Tap the `+` and `-` buttons to log the number of **Parked Cars** and **Cars with Drivers** inside them.
   * If the zone is blocked, select the appropriate checkbox (e.g., Construction, Traffic Detour, Police, City Vehicles, or Other).
7. **Save Details**: Tap **Save Audit Details**. The zone on the map will change color:
   * **Green** if the audit was completed successfully.
   * **Red** if the zone was blocked or impeded.
   * Unaudited zones remain **Blue**.
8. **Check the Dashboard**: Click the **Analytics Dashboard** tab at the top to see charts of your progress and a list of all audited zones.
9. **Export or Sync Your Data**:
   * Click **Export Data** to download your work as an Excel-compatible spreadsheet (CSV) or backup file (JSON).
   * Tap **Open Google Sheet** to see the shared spreadsheet where your data is saved.
   * Tap **Configure Sheets Sync** to link the tool directly to your department's live Google Sheet so updates save online automatically as you work.

---

## How It Works (Behind the Scenes)

Here is what the code is doing in simple terms, without the technical jargon:

### 1. Showing the Map and Zones
The app loads a mapping library that draws the streets of Edmonton. It takes a list of coordinates representing all 268 parking zones and draws them as colored shapes on top of the streets. It automatically updates their colors based on whether you have saved an audit for them.

### 2. Tracking Your Position
The app asks your browser for your GPS location. Every few seconds, as you walk, the app receives your new coordinates and moves the blue dot on the map to show where you are.

### 3. Automatically Detecting Zone Entries
Every time your GPS location updates, the code runs a quick mathematical test. It checks your current position against the boundaries of all 268 parking shapes to see if you have crossed inside one. If you have, it triggers the zone selection, opens the form, and pans the map.

### 4. Synthesizing Sounds Offline
To ensure the tool works offline without requiring internet access to download audio files, the code synthesizes sounds dynamically.
* **The Chime**: When you enter a zone, the code uses your browser's built-in synthesizer to play a clean, pleasant two-tone bell chime.
* **The Warning**: If you start walking into a new zone or try to switch tabs while you have unsaved numbers in your form, the code plays a louder, distinct warning sound and scrolls the screen to show you the "Save" button.

### 5. Looking up Neighborhood and Business Zones
Parking regions and Business Improvement Areas (BIAs) are separate maps. The code calculates the middle point of each parking zone and checks which neighborhood or business boundary shape that point sits inside. It then displays the names (e.g. "Downtown BIA") on your screen so you don't have to look them up.

### 6. Keeping Your Data Safe
The app doesn't need a database server. Every time you tap "Save", the code writes your audit details directly into your browser's secure local memory storage. This memory stays intact even if you turn off your device or close the tab. When you export or sync, the code gathers this local memory and packages it into a spreadsheet file or sends it across the internet to Google Sheets.
