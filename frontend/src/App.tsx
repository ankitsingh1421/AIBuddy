import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import Dashboard from "./pages/Dashboard"


export function App(){
  return  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/auth" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard/>} />
      <Route path="/c/:conversationId" element={<Dashboard/>} />
    </Routes>
  </BrowserRouter>

}
