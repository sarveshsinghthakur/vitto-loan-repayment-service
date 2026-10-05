'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function formatMoney(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function HomePage() {
  const [auth, setAuth] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [signInForm, setSignInForm] = useState({ email: '', password: '' });
  const [signInError, setSignInError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [loanData, setLoanData] = useState(null);
  const [pageError, setPageError] = useState('');
  const [pageNotice, setPageNotice] = useState('');
  const [loadingLoan, setLoadingLoan] = useState(false);

  const [paymentForm, setPaymentForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10) });
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const tokenRef = useRef(null);

  useEffect(() => {
    if (!firebaseConfig.apiKey) return;
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
    const authInstance = getAuth(app);
    setAuth(authInstance);
    const unsubscribe = onAuthStateChanged(authInstance, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) tokenRef.current = null;
    });
    return () => unsubscribe();
  }, []);

  const getToken = useCallback(async () => {
    if (!auth || !user) return null;
    tokenRef.current = await user.getIdToken();
    return tokenRef.current;
  }, [auth, user]);

  const apiFetch = useCallback(
    async (path, options = {}) => {
      const token = await getToken();
      const headers = { ...(options.headers || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.body) headers['Content-Type'] = 'application/json';
      const response = await fetch(path, { ...options, headers });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    },
    [getToken]
  );

  const loadLoanList = useCallback(async () => {
    const { response, data } = await apiFetch('/api/loans');
    if (response.ok) {
      setLoans(data.loans || []);
      return data.loans || [];
    }
    return [];
  }, [apiFetch]);

  const loadLoan = useCallback(
    async (loanId) => {
      if (!loanId) {
        setLoanData(null);
        return;
      }
      setLoadingLoan(true);
      setPageError('');
      setPageNotice('');
      const { response, data } = await apiFetch(`/api/loans/${loanId}`);
      setLoadingLoan(false);
      if (response.ok) {
        setLoanData(data);
      } else {
        setLoanData(null);
        setPageError(data.error?.message || 'Failed to load the loan');
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    if (user) {
      loadLoanList().then((list) => {
        if (list.length > 0 && !selectedLoanId) {
          setSelectedLoanId(list[0].id);
        }
      });
    } else {
      setLoans([]);
      setLoanData(null);
      setSelectedLoanId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (selectedLoanId) loadLoan(selectedLoanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoanId]);

  async function handleSignIn(event) {
    event.preventDefault();
    setSigningIn(true);
    setSignInError('');
    try {
      await signInWithEmailAndPassword(auth, signInForm.email, signInForm.password);
      setSignInForm({ email: '', password: '' });
    } catch (error) {
      setSignInError('Sign-in failed. Check the email and password and try again.');
    } finally {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  async function handlePayment(event) {
    event.preventDefault();
    if (!selectedLoanId) return;
    setSubmittingPayment(true);
    setPageError('');
    setPageNotice('');
    try {
      const { response, data } = await apiFetch(`/api/loans/${selectedLoanId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(paymentForm.amount),
          date: paymentForm.date,
        }),
      });
      if (response.ok) {
        setLoanData(data);
        setPageNotice(
          `Payment of ${formatMoney(data.payment.amount)} recorded against ${data.payment.allocations.length} instalment(s).`
        );
        setPaymentForm((prev) => ({ ...prev, amount: '' }));
        loadLoanList();
      } else if (response.status === 401) {
        setPageError('Your session has expired. Sign in again.');
      } else if (response.status === 409) {
        setPageError('This payment was already submitted and has not been applied twice.');
      } else {
        setPageError(data.error?.message || 'Failed to record the payment');
      }
    } catch (error) {
      setPageError('Network error while recording the payment.');
    } finally {
      setSubmittingPayment(false);
    }
  }

  if (!firebaseConfig.apiKey) {
    return (
      <div className="container">
        <div className="card signin-box">
          <h1>Vitto Loan Repayment Service</h1>
          <p className="muted">
            Firebase client configuration is missing. Set the NEXT_PUBLIC_FIREBASE_* variables in the
            environment and restart the application.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="container">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <div className="card signin-box">
          <h1>Sign in</h1>
          <p className="muted">Loan schedules and payments require authentication.</p>
          {signInError && <div className="alert error">{signInError}</div>}
          <form onSubmit={handleSignIn}>
            <div className="field-row">
              <label>
                Email
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={signInForm.email}
                  onChange={(e) => setSignInForm({ ...signInForm, email: e.target.value })}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={signInForm.password}
                  onChange={(e) => setSignInForm({ ...signInForm, password: e.target.value })}
                />
              </label>
              <button type="submit" disabled={signingIn}>
                {signingIn ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const position = loanData?.position;
  const schedule = loanData?.schedule || [];

  return (
    <div className="container">
      <div className="card topbar">
        <div>
          <h1>Vitto Loan Repayment Service</h1>
          <p className="muted">Signed in as {user.email}</p>
        </div>
        <button className="secondary" type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </div>

      <div className="card">
        <div className="field-row">
          <label>
            Loan
            <select value={selectedLoanId} onChange={(e) => setSelectedLoanId(e.target.value)}>
              <option value="">Select a loan…</option>
              {loans.map((loan) => (
                <option key={loan.id} value={loan.id}>
                  {loan.id.slice(0, 8)} · {formatMoney(loan.principal)} · {loan.tenureMonths}m ·{' '}
                  {loan.annualInterestRate}% · {loan.disbursementDate}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" type="button" onClick={() => loadLoan(selectedLoanId)} disabled={!selectedLoanId || loadingLoan}>
            {loadingLoan ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {pageError && <div className="alert error">{pageError}</div>}
      {pageNotice && <div className="alert success">{pageNotice}</div>}

      {position && (
        <div className="card">
          <h2>
            Current position{' '}
            <span className={`badge ${position.status}`}>{position.status}</span>
          </h2>
          <div className="position-grid">
            <div className="position-item">
              <div className="label">Outstanding principal</div>
              <div className="value">{formatMoney(position.outstandingPrincipal)}</div>
            </div>
            <div className="position-item">
              <div className="label">Next due date</div>
              <div className="value">{position.nextDueDate || '—'}</div>
            </div>
            <div className="position-item">
              <div className="label">Next due amount</div>
              <div className="value">{position.nextDueDate ? formatMoney(position.nextDueAmount) : '—'}</div>
            </div>
            <div className="position-item">
              <div className="label">Overdue amount</div>
              <div className={`value ${position.overdueAmount > 0 ? 'overdue-amount' : ''}`}>
                {formatMoney(position.overdueAmount)}
              </div>
            </div>
          </div>
          <p className="footer-note">As of {position.asOf} · EMI {formatMoney(loanData.loan.emi)}</p>
        </div>
      )}

      <div className="card">
        <h2>Record a payment</h2>
        <form onSubmit={handlePayment}>
          <div className="field-row">
            <label>
              Amount (₹)
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="5000"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              />
            </label>
            <label>
              Payment date
              <input
                type="date"
                required
                value={paymentForm.date}
                onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
              />
            </label>
            <button type="submit" disabled={!selectedLoanId || submittingPayment}>
              {submittingPayment ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </form>
        <p className="footer-note">
          Payments are allocated to the earliest-due unpaid instalment first, interest before principal.
        </p>
      </div>

      <div className="card">
        <h2>Repayment schedule</h2>
        {schedule.length === 0 ? (
          <p className="muted">Select a loan to view its schedule.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Due date</th>
                  <th>Principal</th>
                  <th>Interest</th>
                  <th>Total due</th>
                  <th>Paid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((inst) => {
                  const isPaid = inst.balance <= 0;
                  const isOverdue = !isPaid && inst.dueDate < position.asOf;
                  return (
                    <tr key={inst.installmentNumber} className={isPaid ? 'paid-row' : isOverdue ? 'overdue-row' : ''}>
                      <td>{inst.installmentNumber}</td>
                      <td>{inst.dueDate}</td>
                      <td>{formatMoney(inst.principal)}</td>
                      <td>{formatMoney(inst.interest)}</td>
                      <td>{formatMoney(inst.totalDue)}</td>
                      <td>{formatMoney(inst.amountPaid)}</td>
                      <td>{formatMoney(inst.balance)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
