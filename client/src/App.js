import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import IDEPage from './pages/IDEPage';
import AdminPage from './pages/AdminPage';
import LoadingSpinner from './components/LoadingSpinner';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Router>
      <Routes>
        <Route 
          path="/login" 
          element={!user ? <LoginPage /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="/" 
          element={user ? <DashboardPage /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/ide/:projectId" 
          element={user ? <IDEPage /> : <Navigate to="/login" replace />} 
        />
        <Route 
          path="/admin" 
          element={user?.role === 'teacher' ? <AdminPage /> : <Navigate to="/" replace />} 
        />
        <Route 
          path="*" 
          element={<Navigate to="/" replace />} 
        />
      </Routes>
    </Router>
  );
}

export default App;