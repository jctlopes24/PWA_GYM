import express from "express";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import WorkoutLog from "../models/WorkoutLog.js";
import WorkoutPlan from "../models/WorkoutPlan.js";
import { validationResult } from "express-validator";

const router = express.Router();

// Enviar mensagem
router.post("/", async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados de entrada inválidos',
        errors: errors.array()
      });
    }

    const senderId = req.user._id;
    const { recipientId, message, type = 'chat', priority = 'medium' } = req.body;

    // Verificar se o destinatário existe
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Destinatário não encontrado'
      });
    }

    // Verificar permissões: trainer pode enviar para seus clientes, cliente pode enviar para seu trainer
    const sender = await User.findById(senderId);
    if (sender.role === 'trainer') {
      // Trainer só pode enviar para seus clientes
      if (recipient.role !== 'client' || recipient.assignedTrainer?.toString() !== senderId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado. Este cliente não está atribuído a si.'
        });
      }
    } else if (sender.role === 'client') {
      // Cliente só pode enviar para seu trainer
      if (recipient.role !== 'trainer' || recipient._id.toString() !== sender.assignedTrainer?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado. Só pode enviar mensagens para o seu personal trainer.'
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Apenas trainers e clientes podem enviar mensagens'
      });
    }

    // Criar mensagem
    const newMessage = new Message({
      sender: senderId,
      recipient: recipientId,
      message,
      type,
      priority
    });

    await newMessage.save();

    // Popular dados para resposta
    await newMessage.populate('sender', 'firstName lastName username email');
    await newMessage.populate('recipient', 'firstName lastName username email');

    // Criar notificação para o destinatário
    try {
      const senderName = `${sender.firstName} ${sender.lastName}`;
      await Notification.create({
        recipient: recipientId,
        type: 'message',
        title: 'Nova mensagem',
        message: `${senderName} enviou-lhe uma mensagem`,
        priority: priority === 'urgent' ? 'urgent' : 'medium',
        actionUrl: `/messages/${senderId}`,
        actionLabel: 'Ver mensagem'
      });
    } catch (notifError) {
      console.error('Erro ao criar notificação de mensagem:', notifError);
      // Não falhar o request se a notificação falhar
    }

    res.status(201).json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      data: { message: newMessage }
    });

  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Enviar alerta quando cliente faltar treino
router.post("/alert/workout-missed", async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Dados de entrada inválidos',
        errors: errors.array()
      });
    }

    const trainerId = req.user._id;
    const { clientId, workoutLogId, message, priority = 'high' } = req.body;

    // Verificar se o trainer está aprovado
    const trainer = await User.findById(trainerId);
    if (trainer.role !== 'trainer' || !trainer.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Apenas personal trainers aprovados podem enviar alertas'
      });
    }

    // Verificar se o cliente está atribuído ao trainer
    const client = await User.findById(clientId);
    if (!client || client.role !== 'client') {
      return res.status(404).json({
        success: false,
        message: 'Cliente não encontrado'
      });
    }

    if (client.assignedTrainer?.toString() !== trainerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Este cliente não está atribuído a si'
      });
    }

    // Buscar workout log se fornecido
    let workoutLog = null;
    let workoutPlan = null;
    if (workoutLogId) {
      workoutLog = await WorkoutLog.findById(workoutLogId);
      if (workoutLog) {
        workoutPlan = await WorkoutPlan.findById(workoutLog.workoutPlan);
      }
    }

    // Criar mensagem de alerta
    const alertMessage = new Message({
      sender: trainerId,
      recipient: clientId,
      message: message || 'Faltou ao treino agendado. Por favor, entre em contacto para discutirmos.',
      type: 'alert',
      alertType: 'workout_missed',
      relatedWorkoutLog: workoutLogId,
      relatedWorkoutPlan: workoutPlan?._id,
      priority
    });

    await alertMessage.save();

    // Popular dados
    await alertMessage.populate('sender', 'firstName lastName username email');
    await alertMessage.populate('recipient', 'firstName lastName username email');

    // Criar notificação para o cliente
    try {
      const trainerName = `${trainer.firstName} ${trainer.lastName}`;
      await Notification.create({
        recipient: clientId,
        type: 'message',
        title: 'Alerta do Personal Trainer',
        message: `${trainerName} enviou-lhe um alerta sobre um treino não cumprido`,
        priority: priority === 'urgent' ? 'urgent' : 'high',
        relatedData: {
          workoutLog: workoutLogId,
          workoutPlan: workoutPlan?._id,
          client: clientId
        },
        actionUrl: `/messages/${trainerId}`,
        actionLabel: 'Ver mensagem'
      });
    } catch (notifError) {
      console.error('Erro ao criar notificação de alerta:', notifError);
    }

    res.status(201).json({
      success: true,
      message: 'Alerta enviado com sucesso',
      data: { message: alertMessage }
    });

  } catch (error) {
    console.error('Erro ao enviar alerta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Obter conversa entre dois usuários
router.get("/conversation/:otherUserId", async (req, res) => {
  try {
    const userId = req.user._id;
    const { otherUserId } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verificar se pode acessar esta conversa
    const user = await User.findById(userId);
    const otherUser = await User.findById(otherUserId);

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: 'Utilizador não encontrado'
      });
    }

    // Verificar permissões
    if (user.role === 'trainer') {
      if (otherUser.role !== 'client' || otherUser.assignedTrainer?.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado'
        });
      }
    } else if (user.role === 'client') {
      if (otherUser.role !== 'trainer' || otherUser._id.toString() !== user.assignedTrainer?.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Acesso negado'
        });
      }
    }

    // Buscar mensagens
    const messages = await Message.getConversation(userId, otherUserId, parseInt(limit), skip);
    const total = await Message.countDocuments({
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId }
      ]
    });

    // Marcar mensagens como lidas
    await Message.updateMany(
      { sender: otherUserId, recipient: userId, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.json({
      success: true,
      message: 'Conversa obtida com sucesso',
      data: {
        messages: messages.reverse(), // Reverter para ordem cronológica
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalMessages: total,
          hasNext: skip + messages.length < total,
          hasPrev: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Erro ao obter conversa:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Listar conversas (lista de pessoas com quem há mensagens)
router.get("/conversations", async (req, res) => {
  try {
    const userId = req.user._id;

    // Buscar todas as conversas únicas
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: userId },
            { recipient: userId }
          ]
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$sender', userId] },
              '$recipient',
              '$sender'
            ]
          },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$recipient', userId] },
                    { $eq: ['$isRead', false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          firstName: '$user.firstName',
          lastName: '$user.lastName',
          username: '$user.username',
          email: '$user.email',
          lastMessage: {
            message: '$lastMessage.message',
            type: '$lastMessage.type',
            createdAt: '$lastMessage.createdAt',
            isRead: '$lastMessage.isRead'
          },
          unreadCount: 1
        }
      },
      {
        $sort: { 'lastMessage.createdAt': -1 }
      }
    ]);

    res.json({
      success: true,
      message: 'Conversas obtidas com sucesso',
      data: { conversations }
    });

  } catch (error) {
    console.error('Erro ao obter conversas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Contar mensagens não lidas
router.get("/unread-count", async (req, res) => {
  try {
    const userId = req.user._id;
    const { senderId } = req.query;

    const unreadCount = await Message.getUnreadCount(userId, senderId || null);

    res.json({
      success: true,
      message: 'Contagem de mensagens não lidas obtida com sucesso',
      data: { unreadCount }
    });

  } catch (error) {
    console.error('Erro ao obter contagem de mensagens não lidas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Marcar mensagem como lida
router.put("/:id/read", async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const message = await Message.findOne({
      _id: id,
      recipient: userId
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Mensagem não encontrada'
      });
    }

    await message.markAsRead();

    res.json({
      success: true,
      message: 'Mensagem marcada como lida',
      data: { message }
    });

  } catch (error) {
    console.error('Erro ao marcar mensagem como lida:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;

