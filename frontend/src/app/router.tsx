import { Link, createBrowserRouter } from "react-router";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { CreateEventPage } from "@/features/events/CreateEventPage";
import { EventDetailPage } from "@/features/events/EventDetailPage";
import { EventsPage } from "@/features/events/EventsPage";
import { FinancePage } from "@/features/finance/FinancePage";
import { AcceptInvitationPage } from "@/features/invitations/AcceptInvitationPage";
import { RequireAuth } from "./RequireAuth";

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
        404
      </p>
      <h1 className="text-3xl font-bold text-slate-900">
        Halaman tidak ditemukan
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        Alamat yang Anda tuju tidak tersedia atau sudah dipindahkan.
      </p>
      <Link
        to="/"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Kembali ke beranda
      </Link>
    </main>
  );
}

export const router = createBrowserRouter([
  {
    path: "/auth/login",
    element: <LoginPage />,
  },
  {
    path: "/auth/register",
    element: <RegisterPage />,
  },
  {
    // Halaman terima undangan: publik (di luar RequireAuth) karena detail
    // GET /invitations/:token tidak memakai sesi. Tombol terima mengarahkan
    // ke login dengan state.from bila pengguna belum masuk.
    path: "/invitations/:token",
    element: <AcceptInvitationPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <EventsPage />,
      },
      {
        path: "/events/new",
        element: <CreateEventPage />,
      },
      {
        path: "/events/:eventId",
        element: <EventDetailPage />,
      },
      {
        path: "/events/:eventId/finance",
        element: <FinancePage />,
      },
      {
        path: "/events/:eventId/finance/:transactionId",
        element: <FinancePage />,
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);
