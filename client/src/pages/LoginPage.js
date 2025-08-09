import React from 'react';
import styled from 'styled-components';

const LoginContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
`;

const LoginCard = styled.div`
  background-color: #2d2d2d;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  text-align: center;
  max-width: 400px;
  width: 90%;
`;

const Title = styled.h1`
  color: #ffffff;
  margin-bottom: 10px;
  font-size: 32px;
  font-weight: 600;
`;

const Subtitle = styled.p`
  color: #cccccc;
  margin-bottom: 30px;
  font-size: 16px;
`;

const GoogleButton = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: #4285f4;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  text-decoration: none;
  font-weight: 500;
  transition: background-color 0.2s;

  &:hover {
    background-color: #3367d6;
  }

  svg {
    margin-right: 12px;
    width: 20px;
    height: 20px;
  }
`;

const Features = styled.div`
  margin-top: 40px;
  text-align: left;
`;

const Feature = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  color: #cccccc;
  font-size: 14px;

  &::before {
    content: '✓';
    color: #4caf50;
    margin-right: 12px;
    font-weight: bold;
  }
`;

const ErrorMessage = styled.div`
  background-color: #f44336;
  color: white;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
  text-align: center;
`;

const LoginPage = () => {
  const [errorMessage, setErrorMessage] = React.useState('');

  React.useEffect(() => {
    // URLパラメータからエラーを確認
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    
    if (error === 'unauthorized') {
      setErrorMessage('このアプリケーションの利用権限がありません。許可されたアカウントでログインしてください。');
    } else if (error === 'auth_failed') {
      setErrorMessage('認証に失敗しました。再度お試しください。');
    }
  }, []);

  const handleGoogleLogin = () => {
    console.log('Google login button clicked');
    setErrorMessage(''); // エラーメッセージをクリア
    const authUrl = 'http://localhost:3001/api/auth/google';
    console.log('Redirecting to:', authUrl);
    window.location.href = authUrl;
  };

  return (
    <LoginContainer>
      <LoginCard>
        <Title>MindCode</Title>
        <Subtitle>教育用Web開発統合環境</Subtitle>
        
        {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
        
        <GoogleButton onClick={handleGoogleLogin}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Googleアカウントでログイン
        </GoogleButton>

        <Features>
          <Feature>シンタックスハイライト付きモナコエディタ</Feature>
          <Feature>ライブプレビュー機能</Feature>
          <Feature>Git統合バージョン管理</Feature>
          <Feature>Claude Code AI支援</Feature>
          <Feature>ファイル・フォルダ管理</Feature>
          <Feature>教師用管理パネル</Feature>
        </Features>
      </LoginCard>
    </LoginContainer>
  );
};

export default LoginPage;