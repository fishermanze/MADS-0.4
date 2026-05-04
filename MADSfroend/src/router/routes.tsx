import { createBrowserRouter } from "react-router-dom";
import MadsPage from "../MadsPage";
import StatisticsPage from "../StatisticsPage";
import InterventionExperimentPage from "../InterventionExperimentPage";
import LandingPage from "../LandingPage";
import LoginPage from "../LoginPage";
import RegisterPage from "../RegisterPage";
import SettingsPage from "../SettingsPage";
import RequireAuthLayout from "./RequireAuthLayout";
import AdminOnly from "./AdminOnly";

export const router = createBrowserRouter([
  {
    path: "/",
    children: [
      { index: true, Component: LandingPage },
      { path: "login", Component: LoginPage },
      { path: "register", Component: RegisterPage },
      {
        Component: RequireAuthLayout,
        children: [
          { path: "MADS", Component: MadsPage },
          { path: "INTERVENTION", Component: InterventionExperimentPage },
          {
            path: "STAT",
            element: (
              <AdminOnly>
                <StatisticsPage />
              </AdminOnly>
            ),
          },
          { path: "SETTINGS", Component: SettingsPage },
        ],
      },
    ],
  },
]);
