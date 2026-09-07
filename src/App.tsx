import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "@/app/AppContext";
import Layout from "@/components/Layout";
import { CampaignPage, ContactPage, DonatePage, ImpactPage, MapPage, NewsPage, NotFoundPage, RegistrationPage, ReportPage } from "@/pages";
import HomePage from "@/pages/HomePage";
import AboutPage from "@/pages/AboutPage";

export default function App() {
  return <BrowserRouter basename={import.meta.env.BASE_URL}>
    <AppDataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="ve-ha-noi-xanh" element={<AboutPage />} />
          <Route path="gioi-thieu" element={<Navigate to="/ve-ha-noi-xanh" replace />} />
          <Route path="chien-dich" element={<CampaignPage />} />
          <Route path="dang-ky/:eventId" element={<RegistrationPage />} />
          <Route path="ban-do" element={<MapPage />} />
          <Route path="tac-dong" element={<ImpactPage />} />
          <Route path="ung-ho" element={<DonatePage />} />
          <Route path="bao-o-nhiem" element={<ReportPage />} />
          <Route path="lien-he" element={<ContactPage />} />
          <Route path="tin-tuc" element={<NewsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AppDataProvider>
  </BrowserRouter>;
}
