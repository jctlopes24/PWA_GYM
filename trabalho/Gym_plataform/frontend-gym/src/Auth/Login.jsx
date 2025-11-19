import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const Login = () => {
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prevState => ({
            ...prevState,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const response = await fetch('/api/auth/login', { // Ajustei o endpoint
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    username: formData.email, // O teu backend espera 'username' ou 'email'
                    password: formData.password
                })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || data.error || 'Erro no login');
            }

            // Verifica se a resposta tem a estrutura esperada
            if (!data.success) {
                throw new Error(data.message || 'Login falhou');
            }

            // Salva os dados (ajustado para a estrutura do teu backend)
            localStorage.setItem('token', data.data.token);
            localStorage.setItem('user', JSON.stringify(data.data.user)); 

            console.log('Dados salvos:', {
                token: !!data.data.token,
                user: data.data.user,
                role: data.data.user.role
            }); 

            // Dispara evento para atualizar componentes
            window.dispatchEvent(new Event('userChanged'));
            console.log('Evento userChanged disparado');

            setFormData({ email: '', password: '' });

            // Redireciona conforme o role
            if (data.data.user.role === 'admin') {
                navigate('/produtos');
            } else {
                navigate('/');
            }

        } catch (err) {
            console.error('Erro no login:', err);
            setError(err.message || 'Erro ao fazer login');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <h2>Login</h2>
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                    <label htmlFor="email">Email ou Username:</label>
                    <input
                        type="text"
                        id="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        placeholder="exemplo@email.com ou username"
                        disabled={loading}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="password">Palavra-passe:</label>
                    <input
                        type="password"
                        id="password"
                        name="password"
                        value={formData.password}
                        onChange={handleChange}
                        required
                        placeholder="Sua palavra-passe"
                        disabled={loading}
                    />
                </div>

                <button type="submit" className="submit-button" disabled={loading}>
                    {loading ? 'Entrando...' : 'Entrar'}
                </button>
            </form>
            
            <Link to="/recuperar-password" className="forgot-password">
                Esqueci-me da palavra-passe
            </Link>

            <div className="login-footer">
                <p>Não tem conta? <Link to="/register">Registe-se aqui</Link></p>
            </div>
        </div>
    );
};

export default Login;