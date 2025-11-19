import express from "express";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import { validationResult } from "express-validator";

const router = express.Router();

// gerar token
const generateToken = (userId) => {
  console.log('JWT_SECRET:', process.env.JWT_SECRET ? 'Definido' : 'NÃO DEFINIDO');
  console.log('JWT_EXPIRE:', process.env.JWT_EXPIRE || '7d');
  
  // usar chave temporaria
  const secret = process.env.JWT_SECRET || 'my_super_secret_jwt_key_2024_gym_management_system_xyz123';
  console.log('Usando secret:', secret ? 'SIM' : 'NÃO');
  
  return jwt.sign(
    { userId },
    secret,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

// regsistro de user
router.post("/register", async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados de entrada inválidos',
        errors: errors.array()
      });
    }

    const { username, email, password, firstName, lastName, phone, dateOfBirth, gender, role = 'client' } = req.body;

    // verificar se user existe
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email ? 'Email já registado' : 'Username já existe'
      });
    }

    // criar user
    const user = await User.create({
      username,
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      role
    });

    // gerar QR Code
    let qrCodeUrl = null;
    try {
      const qrData = JSON.stringify({
        userId: user._id,
        username: user.username,
        timestamp: Date.now()
      });
      
      qrCodeUrl = await QRCode.toDataURL(qrData);
      user.qrCode = qrCodeUrl;
      await user.save();
      console.log('QR Code gerado com sucesso');
    } catch (qrError) {
      console.error('Erro ao gerar QR Code:', qrError);
      // Continuar sem QR Code se houver erro
    }

    // gerar token
    let token;
    try {
      token = generateToken(user._id);
      console.log('Token gerado com sucesso');
    } catch (tokenError) {
      console.error('Erro ao gerar token:', tokenError);
      throw new Error('Erro ao gerar token de autenticação');
    }

    // atualizar ultimo login
    try {
      user.lastLogin = new Date();
      await user.save();
      console.log('Último login atualizado');
    } catch (loginError) {
      console.error('Erro ao atualizar último login:', loginError);
      // Não é crítico, continuar
    }

    res.status(201).json({
      success: true,
      message: 'Utilizador registado com sucesso',
      data: {
        token,
        user: user.getPublicProfile(),
        qrCode: qrCodeUrl
      }
    });

  } catch (error) {
    console.error('Erro no registo:', error);
    console.error('Stack trace:', error.stack);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field} já existe`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      details: process.env.NODE_ENV === 'development' ? {
        name: error.name,
        stack: error.stack
      } : undefined
    });
  }
});

// login de user
router.post("/login", async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados de entrada inválidos',
        errors: errors.array()
      });
    }

    const { username, password } = req.body;

    // encontrar user
    const user = await User.findOne({
      $or: [{ username }, { email: username }]
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // verificar se conta esta bloqueada
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Conta temporariamente bloqueada devido a muitas tentativas de login'
      });
    }

    // verificar se conta esta ativa
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Conta desativada'
      });
    }

    // verificar password
    const isPasswordValid = await user.matchPassword(password);
    if (!isPasswordValid) {
      await user.incLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // reset tentativas de login
    await user.resetLoginAttempts();

    // gerar token
    const token = generateToken(user._id);

    // atualizar ultimo login
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      data: {
        token,
        user: user.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// login com QR code
router.post("/login/qr", async (req, res) => {
  try {
    const { qrData } = req.body;

    if (!qrData) {
      return res.status(400).json({
        success: false,
        message: 'Dados do QR Code são obrigatórios'
      });
    }

    let parsedData;
    try {
      parsedData = JSON.parse(qrData);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'QR Code inválido'
      });
    }

    const { userId, timestamp } = parsedData;
    
    // verifica validade do qrcode
    const now = Date.now();
    if (now - timestamp > 5 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        message: 'QR Code expirado'
      });
    }

    // encontrar user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilizador não encontrado'
      });
    }

    
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Conta desativada'
      });
    }

    // gerar token
    const token = generateToken(user._id);

    // Atualizar último login
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login por QR Code realizado com sucesso',
      data: {
        token,
        user: user.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Erro no login por QR Code:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// gerar novo QR Code
router.post("/qr/generate", async (req, res) => {
  try {
    const user = req.user;

    const qrData = JSON.stringify({
      userId: user._id,
      username: user.username,
      timestamp: Date.now()
    });
    
    const qrCodeUrl = await QRCode.toDataURL(qrData);
    
    // atualizar QR Code no user
    user.qrCode = qrCodeUrl;
    await user.save();

    res.json({
      success: true,
      message: 'QR Code gerado com sucesso',
      data: {
        qrCode: qrCodeUrl
      }
    });

  } catch (error) {
    console.error('Erro ao gerar QR Code:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// verificar token
router.get("/verify", async (req, res) => {
  try {
    const user = req.user;
    
    res.json({
      success: true,
      message: 'Token válido',
      data: {
        user: user.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// logout (opcional)
router.post("/logout", async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logout realizado com sucesso'
    });
  } catch (error) {
    console.error('Erro no logout:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// refresh token (opcional)
router.post("/refresh", async (req, res) => {
  try {
    const user = req.user;
    
    // gerar novo token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Token renovado com sucesso',
      data: {
        token,
        user: user.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Erro ao renovar token:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
