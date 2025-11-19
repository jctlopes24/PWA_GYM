import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Auth/Login';
import Register from './Auth/Register';
import './App.css';

function App() {
  // Verifica se o user está autenticado
  const isAuthenticated = () => {
    return !!localStorage.getItem('token');
  };

  const getUserRole = () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user).role : null;
  };

  return (
    <Router>
      <div className="App">
        <Routes>
          {/* Rotas públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          <Route 
            path="/produtos" 
            element={
              isAuthenticated() && getUserRole() === 'admin' ? (
                <div className="placeholder-page">
                  <h1>Página de Produtos (Admin)</h1>
                  <p>Esta página será implementada em breve.</p>
                </div>
              ) : (
                <Navigate to="/login" />
              )
            } 
          />
          
          <Route 
            path="/" 
            element={
              isAuthenticated() ? (
                <div className="placeholder-page">
                  <h1>Página Inicial</h1>
                  <p>Bem-vindo! O dashboard será implementado em breve.</p>
                </div>
              ) : (
                <Navigate to="/login" />
              )
            } 
          />

          {/* Rota padrão */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;