# Marta · Role Tracker

Tracker aktywnych ofert **People Ops / HRBP / HR Ops / P&C** dopasowanych do profilu Marty (Wrocław + remote PL).

## Start

```bash
cd tracker/app
npm install
cp .env.example .env   # uzupełnij Supabase URL + anon key
npm run dev
```

## Vercel

Root Directory w projekcie Vercel: **`tracker/app`** (albo root repo z `vercel.json`).

Environment variables:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Logowanie

Konto w Supabase Auth (login/hasło u Marty — nie commituj haseł do repo).

## Co jest w bazie

- Tabela `jobs` — **68** zweryfikowanych ofert (2026-09-09)
  - deep link do ogłoszenia, firma, lokalizacja, opis, **dlaczego fit**, score 1–5, źródło
- Tabela `outreach` — status + notatka per oferta (`job_id` + user), RLS

Źródła researchu: **Pracuj.pl**, **RocketJobs**, **Workday (Aliaxis)**, careers firm; LinkedIn/agregatory tylko jako sygnał → link do careers.

## Jak czytać fit score

- **5** — mocny People Ops / multi-country / product WR (np. Aliaxis HRBP, Opera HR Specialist, Zrzutka HRBP, DEKRA HR Ops multi-country)
- **4** — dobry overlap (HRBP/People Ops/payroll IT, hybrid WR lub remote)
- **3** — sensowny, ale lokalizacja poza WR / wąski scope / agency
- **2** — DE required / junior / czysty GBS — na radarze, niski priorytet

## UI

Kompaktowa lista: score · tytuł · firma · lokalizacja · link Oferta · fit reason · status/notatka · rozwijany opis.
