import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { api } from "./lib/api.js";
import Login from "./pages/Login.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import ClientDashboard from "./pages/ClientDashboard.jsx";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(undefined);

  async function loadMe() {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  if (user === undefined) {
    return <div className="loading-screen">Загрузка…</div>;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login onLoggedIn={loadMe} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {user.role === "admin" ? (
        <Route path="*" element={<AdminDashboard user={user} onLogout={loadMe} />} />
      ) : (
        <Route path="*" element={<ClientDashboard user={user} onLogout={loadMe} />} />
      )}
    </Routes>
  );
}
