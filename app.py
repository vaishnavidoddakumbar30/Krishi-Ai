from flask import Flask, request, jsonify, session, render_template, redirect, url_for
import sqlite3, hashlib, os, requests, base64
from datetime import datetime
from functools import wraps
from dotenv import load_dotenv
import google.generativeai as genai

# Setup Gemini
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)
# Use Gemini 3 Flash (Fast & specifically good for vision tasks)
gemini_model = genai.GenerativeModel('gemini-3-flash-preview')

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)


GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY")

DB_PATH = "farm.db"

# ─── Database ───────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS advice_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                crop TEXT NOT NULL,
                location TEXT NOT NULL,
                weather_data TEXT,
                advice TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                message TEXT NOT NULL,
                response TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        """)

init_db()

# ─── Helpers ────────────────────────────────────────────────────────────────

def hash_password(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return decorated

def groq_chat(messages, max_tokens=800):
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7
    }
    r = requests.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

LANG_NAMES = {"en": "English", "kn": "Kannada", "hi": "Hindi"}

def lang_instruction(lang):
    name = LANG_NAMES.get(lang, "English")
    return f"Respond ONLY in {name}. Do not use any other language."

# ─── Auth ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if "user_id" in session:
        return render_template("app.html", username=session.get("username"))
    return render_template("index.html")

@app.route("/signup", methods=["POST"])
def signup():
    d = request.get_json()
    username = d.get("username","").strip()
    email = d.get("email","").strip()
    password = d.get("password","")
    if not username or not email or not password:
        return jsonify({"error": "All fields are required"}), 400
    try:
        with get_db() as db:
            db.execute("INSERT INTO users (username,email,password) VALUES (?,?,?)",
                       (username, email, hash_password(password)))
        return jsonify({"message": "Account created successfully"})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Username or email already exists"}), 400

@app.route("/login", methods=["POST"])
def login():
    d = request.get_json()
    username = d.get("username","").strip()
    password = d.get("password","")
    with get_db() as db:
        user = db.execute("SELECT * FROM users WHERE username=? AND password=?",
                          (username, hash_password(password))).fetchone()
    if not user:
        return jsonify({"error": "Invalid credentials"}), 401
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return jsonify({"message": "Login successful", "username": user["username"]})

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"})

# ─── Weather ─────────────────────────────────────────────────────────────────

@app.route("/weather")
@login_required
def weather():
    location = request.args.get("location","")
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    try:
        if lat and lon:
            url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
            forecast_url = f"https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric&cnt=8"
        else:
            url = f"https://api.openweathermap.org/data/2.5/weather?q={location}&appid={OPENWEATHER_API_KEY}&units=metric"
            forecast_url = f"https://api.openweathermap.org/data/2.5/forecast?q={location}&appid={OPENWEATHER_API_KEY}&units=metric&cnt=8"

        w = requests.get(url, timeout=10).json()
        f = requests.get(forecast_url, timeout=10).json()

        if w.get("cod") != 200:
            return jsonify({"error": w.get("message","Location not found")}), 400

        forecast = []
        for item in f.get("list", []):
            forecast.append({
                "time": item["dt_txt"],
                "temp": item["main"]["temp"],
                "humidity": item["main"]["humidity"],
                "pop": item.get("pop", 0),
                "desc": item["weather"][0]["description"]
            })

        return jsonify({
            "city": w["name"],
            "country": w["sys"]["country"],
            "temp": w["main"]["temp"],
            "feels_like": w["main"]["feels_like"],
            "humidity": w["main"]["humidity"],
            "pressure": w["main"]["pressure"],
            "description": w["weather"][0]["description"],
            "icon": w["weather"][0]["icon"],
            "wind_speed": w["wind"]["speed"],
            "rain": w.get("rain", {}).get("1h", 0),
            "forecast": forecast
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── Farming Advice ──────────────────────────────────────────────────────────

@app.route("/get-advice", methods=["POST"])
@login_required
def get_advice():
    d = request.get_json()
    crop = d.get("crop","")
    location = d.get("location","")
    weather = d.get("weather", {})
    lang = d.get("language","en")

    if not crop:
        return jsonify({"error": "Crop name is required"}), 400

    weather_str = ""
    if weather:
        weather_str = f"""
Current Weather at {weather.get('city','the location')}:
- Temperature: {weather.get('temp','N/A')}°C (Feels like {weather.get('feels_like','N/A')}°C)
- Humidity: {weather.get('humidity','N/A')}%
- Conditions: {weather.get('description','N/A')}
- Wind Speed: {weather.get('wind_speed','N/A')} m/s
- Rainfall (last 1h): {weather.get('rain',0)} mm
"""

    messages = [
        {"role": "system", "content": f"You are an expert agricultural advisor. {lang_instruction(lang)} Provide practical, actionable advice for farmers."},
        {"role": "user", "content": f"""Give comprehensive farming advice for {crop} crop in {location or 'the given location'}.
{weather_str}
Provide:
1. Smart farming advice specific to current weather
2. Irrigation recommendation (amount and frequency)
3. Weather-based crop care tips
4. Potential risks and how to mitigate them
5. Best practices for this season

Format with clear sections and bullet points."""}
    ]

    try:
        advice = groq_chat(messages, max_tokens=1000)
        with get_db() as db:
            db.execute("""INSERT INTO advice_history (user_id,crop,location,weather_data,advice,language)
                          VALUES (?,?,?,?,?,?)""",
                       (session["user_id"], crop, location, str(weather), advice, lang))
        return jsonify({"advice": advice})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── History ─────────────────────────────────────────────────────────────────

@app.route("/history")
@login_required
def history():
    with get_db() as db:
        rows = db.execute("""SELECT id,crop,location,advice,language,timestamp
                             FROM advice_history WHERE user_id=?
                             ORDER BY timestamp DESC LIMIT 20""",
                          (session["user_id"],)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/history/<int:hid>", methods=["DELETE"])
@login_required
def delete_history(hid):
    with get_db() as db:
        db.execute("DELETE FROM advice_history WHERE id=? AND user_id=?", (hid, session["user_id"]))
    return jsonify({"message": "Deleted"})

# ─── Chat ────────────────────────────────────────────────────────────────────

@app.route("/chat", methods=["POST"])
@login_required
def chat():
    d = request.get_json()
    message = d.get("message","")
    lang = d.get("language","en")
    history = d.get("history", [])

    if not message:
        return jsonify({"error": "Message required"}), 400

    messages = [{"role": "system", "content": f"You are a helpful farming assistant who knows about agriculture, crops, soil, weather, and farming techniques. {lang_instruction(lang)} Be concise and practical."}]
    for h in history[-6:]:
        messages.append({"role": "user", "content": h["user"]})
        messages.append({"role": "assistant", "content": h["bot"]})
    messages.append({"role": "user", "content": message})

    try:
        response = groq_chat(messages, max_tokens=600)
        with get_db() as db:
            db.execute("INSERT INTO chat_history (user_id,message,response,language) VALUES (?,?,?,?)",
                       (session["user_id"], message, response, lang))
        return jsonify({"response": response})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── Image Analysis ──────────────────────────────────────────────────────────

# @app.route("/upload-image", methods=["POST"])
# @login_required
# def upload_image():
#     lang = request.form.get("language","en")
#     crop = request.form.get("crop","crop")

#     if "image" not in request.files:
#         return jsonify({"error": "No image uploaded"}), 400

#     file = request.files["image"]
#     img_data = base64.b64encode(file.read()).decode("utf-8")
#     mime = file.content_type or "image/jpeg"

#     # Use Groq vision model
#     headers = {
#         "Authorization": f"Bearer {GROQ_API_KEY}",
#         "Content-Type": "application/json"
#     }
#     payload = {
#         "model": "llama-3.2-11b-vision-preview",
#         "messages": [{
#             "role": "user",
#             "content": [
#                 {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_data}"}},
#                 {"type": "text", "text": f"""Analyze this {crop} plant image and provide:
# 1. Disease/pest detection (if any visible issues)
# 2. Overall plant health assessment
# 3. Recommended fertilizers with dosage
# 4. Pesticide recommendations if needed
# 5. Irrigation advice based on plant appearance
# 6. Treatment steps in order
# 7. Prevention tips for future

# {lang_instruction(lang)}
# Format with clear numbered sections."""}
#             ]
#         }],
#         "max_tokens": 1000
#     }

#     try:
#         r = requests.post("https://api.groq.com/openai/v1/chat/completions", json=payload, headers=headers, timeout=40)
#         r.raise_for_status()
#         result = r.json()["choices"][0]["message"]["content"]
#         return jsonify({"analysis": result})
#     except Exception as e:
#         return jsonify({"error": f"Image analysis failed: {str(e)}"}), 500
@app.route("/upload-image", methods=["POST"])
@login_required
def upload_image():
    lang = request.form.get("language", "en")
    crop = request.form.get("crop", "plant")

    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files["image"]

    try:
        # 1. Read the image into bytes
        image_bytes = file.read()
        
        # 2. Format the image for Gemini
        image_parts = [
            {
                "mime_type": file.content_type or "image/jpeg",
                "data": image_bytes
            }
        ]

        # 3. Create the prompt using your existing language logic
        prompt = f"""Analyze this {crop} plant image. {lang_instruction(lang)} 
        Provide a detailed health assessment, identify any specific diseases or pests, 
        and list clear treatment steps and fertilizer recommendations."""

        # 4. Generate the analysis
        response = gemini_model.generate_content([prompt, image_parts[0]])
        
        return jsonify({"analysis": response.text})

    except Exception as e:
        return jsonify({"error": f"Gemini analysis failed: {str(e)}"}), 500
    

@app.route("/me")
def me():
    if "user_id" in session:
        return jsonify({"logged_in": True, "username": session["username"]})
    return jsonify({"logged_in": False})

if __name__ == "__main__":
    app.run(debug=True, port=5000)