
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function DashboardLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-grow p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default DashboardLayout;
