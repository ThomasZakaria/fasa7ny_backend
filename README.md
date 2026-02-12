# 🌍 Fasa7ny Backend API

**Fasa7ny** is a smart tourism recommendation engine and backend API designed to help users discover the best places to visit in Egypt. It utilizes a weighted scoring algorithm to suggest locations based on user interests, budget, location, and visit history.

## 🚀 Features

* **Smart Recommendation Engine:** Suggests places based on a custom scoring algorithm (+Interest, +Location, -History).
* **Budget Filtering:** Intelligent parsing of price strings (e.g., "60EGP" -> "Budget") to match user financial preferences.
* **CRUD Operations:** Full management (Create, Read, Update, Delete) for tourism landmarks.
* **Cloud Database:** Fully integrated with MongoDB Atlas for scalable data storage.
* **Secure:** Environment variable protection for database credentials.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB (via Mongoose ODM)
* **Utilities:** Multer (File handling), Dotenv (Security)

---

## ⚙️ Installation & Setup

Follow these steps to run the project locally.

### 1. Clone the Repository

```bash
git clone https://github.com/ThomasZakaria/fasa7ny-backend.git
cd fasa7ny-backend

```

### 2. Install Dependencies

```bash
npm install

```

### 3. Environment Configuration

Create a file named `.env` in the root directory. Add your MongoDB connection string (ensure your IP is whitelisted on Atlas):

```env
DATABASE_URL=mongodb+srv://<USERNAME>:<PASSWORD>@cluster0.x8hay3e.mongodb.net/fasahni

```

### 4. Run the Server

For development (with auto-restart):

```bash
npx nodemon app.js

```

For production:

```bash
node app.js

```

*The server will start on **Port 3000**.*

---

## 📡 API Documentation

### 1. Recommendation System

**Endpoint:** `POST /api/v1/recommend`

Generates a list of top 10 places based on the user profile.

**Request Body Example:**

```json
{
  "interests": ["Ancient Temples", "Mosque"],
  "latest_city": "Cairo",
  "budget": "budget",
  "history": ["Pyramids of Giza"] 
}

```

*Note: The `history` array ensures the user doesn't get recommendations for places they have already visited.*

**Response:**

```json
{
  "status": "success",
  "recommendations": [
    {
      "name": "Al Fath Mosque",
      "city": "Cairo",
      "category": "Mosque",
      "price": "Free",
      "score": 5
    }
  ]
}

```

### 2. Manage Places (CRUD)

| Method | Endpoint | Description |
| --- | --- | --- |
| **GET** | `/api/v1/places` | Get all stored places |
| **GET** | `/api/v1/places/:id` | Get details of a specific place |
| **POST** | `/api/v1/places` | Add a new place to the database |
| **PATCH** | `/api/v1/places/:id` | Update an existing place |
| **DELETE** | `/api/v1/places/:id` | Delete a place |

---

## 🧠 How the Algorithm Works

The recommendation engine assigns a **Score** to every place in the database relative to the user:

1. **Interest Match (+3 Points):** If the place category matches user interests.
2. **Location Match (+2 Points):** If the place is in the user's current city.
3. **History Check (-5 Points):** If the user has already visited the place (drastically lowers priority).
4. **Budget Filter:**
* Strictly filters out places above the user's selected budget.
* *Logic:* Free < Budget < Medium < Fancy.



