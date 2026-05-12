import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import Auth from "./pages/Auth"
import Dashboard from "./pages/Dashboard"


export function App(){
  return  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/auth" element={<Auth/>}/>
      <Route path="/dashboard" element={<Dashboard/>} />
    </Routes>
  </BrowserRouter>

}
