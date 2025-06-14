const express = require('express');
const router = express.Router();
const prisma = require('../../src/lib/prisma');
const bcrypt = require('bcryptjs');
const { auth } = require('../../middleware/index-prisma');
const { LOG_TYPES, MODULES, ACTIONS, STATUS } = require('../../services/logging-prisma.service');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for avatar uploads
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(process.cwd(), 'public/uploads/avatars');
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'avatar-' + uniqueSuffix + ext);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept only image files
        const allowedTypes = /jpeg|jpg|png|gif/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files (.jpg, .jpeg, .png, .gif) are allowed'));
        }
    }
});

// Note: Using auth.isAdmin middleware from middleware/index-prisma.js instead of custom checkAdmin

// Get list of all users (admin only)
router.get('/users-list', auth.isAdmin, async (req, res) => {
    try {
        // Parse pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Get total count for pagination
        const totalCount = await prisma.wP_USER_REGISTRATION.count();

        // Fetch users with pagination
        const users = await prisma.wP_USER_REGISTRATION.findMany({
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Username: true,
                Phone: true,
                UserType: true,
                Admin: true,
                ValidStatus: true,
                TwoFactorEnabled: true,
                NotificationsEnabled: true,
                CreateTS: true,
                LastLoginTime: true,
                ProfilePicture: true
            },
            orderBy: {
                CreateTS: 'desc'
            },
            take: limit,
            skip: offset
        });

        // Format the response
        const formattedUsers = users.map(user => ({
            ...user,
            isActive: user.ValidStatus === '1',
            lastLoginTime: user.LastLoginTime ? new Date(user.LastLoginTime).toISOString() : null,
            createTS: user.CreateTS ? new Date(user.CreateTS).toISOString() : null
        }));

        res.json({
            success: true,
            users: formattedUsers,
            pagination: {
                total: totalCount,
                page,
                limit,
                pages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching users list:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users list'
        });
    }
});

// Get single user details (admin only)
router.get('/users-list/:id', auth.isAdmin, async (req, res) => {
    try {
        const user = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: parseInt(req.params.id) },
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Username: true,
                Phone: true,
                UserType: true,
                Admin: true,
                ValidStatus: true,
                TwoFactorEnabled: true,
                NotificationsEnabled: true,
                CreateTS: true,
                LastLoginTime: true,
                ProfilePicture: true,
                TIN: true,
                IDType: true,
                IDValue: true
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                ...user,
                isActive: user.ValidStatus === '1',
                lastLoginTime: user.LastLoginTime ? new Date(user.LastLoginTime).toISOString() : null,
                createTS: user.CreateTS ? new Date(user.CreateTS).toISOString() : null
            }
        });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user details'
        });
    }
});

// Add new user (admin only)
router.post('/users-add', auth.isAdmin, async (req, res) => {
    try {
        const {
            fullName, email, username, password, userType,
            phone, admin, twoFactorEnabled, notificationsEnabled,
            validStatus, profilePicture, TIN, IDType, IDValue
        } = req.body;

        // Validate required fields
        if (!fullName || !email || !username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Required fields missing'
            });
        }

        // Check if username or email already exists
        const existingUser = await prisma.wP_USER_REGISTRATION.findFirst({
            where: {
                OR: [
                    { Username: username },
                    { Email: email }
                ]
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username or email already exists'
            });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user with all fields
        const newUser = await prisma.wP_USER_REGISTRATION.create({
            data: {
                FullName: fullName,
                Email: email,
                Username: username,
                Password: hashedPassword,
                UserType: userType || null,
                TIN: TIN || null,
                IDType: IDType || null,
                IDValue: IDValue || null,
                Phone: phone || null,
                Admin: admin ? 1 : 0,
                ValidStatus: validStatus || '1',
                TwoFactorEnabled: twoFactorEnabled ? true : false,
                NotificationsEnabled: notificationsEnabled ? true : false,
                ProfilePicture: profilePicture || null,
                CreateTS: new Date(),
                UpdateTS: new Date(),
            }
        });

        // Log the action
        await prisma.wP_LOGS.create({
            data: {
                Description: `User ${req.session.user.username} created new user: ${username}`,
                CreateTS: new Date(),
                LoggedUser: req.session.user.username,
                Action: ACTIONS.CREATE_USER,
                IPAddress: req.ip,
                LogType: LOG_TYPES.INFO,
                Module: MODULES.USER,
                Status: STATUS.SUCCESS,
                UserID: req.session.user.id
            }
        });

        // Fetch the created user with all fields
        const createdUser = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: newUser.ID },
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Username: true,
                Phone: true,
                UserType: true,
                Admin: true,
                ValidStatus: true,
                TwoFactorEnabled: true,
                NotificationsEnabled: true,
                CreateTS: true,
                LastLoginTime: true,
                ProfilePicture: true
            }
        });

        res.json({
            success: true,
            message: 'User created successfully',
            user: createdUser
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user',
            error: error.message
        });
    }
});

// Update user (admin only)
router.put('/users-update/:id', auth.isAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { email, fullName, password, phone, admin, validStatus, twoFactorEnabled, notificationsEnabled } = req.body;

        // Validate required fields
        if (!email || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Full Name and Email are required'
            });
        }

        // Get existing user data to preserve other fields
        const user = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: id }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if email is already used by another user
        const existingUser = await prisma.wP_USER_REGISTRATION.findFirst({
            where: {
                Email: email,
                ID: { not: id }
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email is already in use by another user'
            });
        }

        // Prepare update data
        const updateData = {
            Email: email,
            FullName: fullName,
            UpdateTS: new Date(),
            Phone: phone || user.Phone,
            Admin: admin !== undefined ? (admin ? 1 : 0) : user.Admin,
            ValidStatus: validStatus || user.ValidStatus,
            TwoFactorEnabled: twoFactorEnabled !== undefined ? twoFactorEnabled : user.TwoFactorEnabled,
            NotificationsEnabled: notificationsEnabled !== undefined ? notificationsEnabled : user.NotificationsEnabled
        };

        // Only update password if provided
        if (password) {
            const saltRounds = 10;
            updateData.Password = await bcrypt.hash(password, saltRounds);
        }

        // Update user profile
        await prisma.wP_USER_REGISTRATION.update({
            where: { ID: id },
            data: updateData
        });

        // Log the action
        await prisma.wP_LOGS.create({
            data: {
                Description: `User ${req.session.user.username} updated user: ${user.Username}`,
                CreateTS: new Date(),
                LoggedUser: req.session.user.username,
                Action: ACTIONS.UPDATE_USER,
                IPAddress: req.ip,
                LogType: LOG_TYPES.INFO,
                Module: MODULES.USER,
                Status: STATUS.SUCCESS,
                UserID: req.session.user.id
            }
        });

        // Fetch updated user
        const updatedUser = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: id },
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Username: true,
                Phone: true,
                UserType: true,
                Admin: true,
                ValidStatus: true,
                TwoFactorEnabled: true,
                NotificationsEnabled: true,
                CreateTS: true,
                LastLoginTime: true,
                ProfilePicture: true
            }
        });

        res.json({
            success: true,
            message: 'User updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user',
            error: error.message
        });
    }
});

// Profile endpoint for session checking
router.get('/profile', auth.isApiAuthenticated, async (req, res) => {
    try {
        // Authentication is handled by auth.isApiAuthenticated middleware

        const user = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: req.session.user.id },
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Phone: true,
                Username: true,
                Admin: true,
                TIN: true,
                IDType: true,
                IDValue: true,
                CreateTS: true,
                ValidStatus: true,
                LastLoginTime: true,
                ProfilePicture: true,
                TwoFactorEnabled: true,
                NotificationsEnabled: true,
                UpdateTS: true
            }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                ...user,
                isActive: user.ValidStatus === '1',
                lastLoginTime: user.LastLoginTime ? new Date(user.LastLoginTime).toISOString() : null,
                createTS: user.CreateTS ? new Date(user.CreateTS).toISOString() : null,
                updateTS: user.UpdateTS ? new Date(user.UpdateTS).toISOString() : null
            }
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user profile'
        });
    }
});

// Update user profile (for current user)
router.post('/update-profile', auth.isApiAuthenticated, async (req, res) => {
    try {
        // Authentication is handled by auth.isApiAuthenticated middleware

        const userId = req.session.user.id;
        const { fullName, email, phone, currentPassword, newPassword } = req.body;

        // Validate required fields
        if (!fullName || !email) {
            return res.status(400).json({
                success: false,
                message: 'Full Name and Email are required'
            });
        }

        // Get existing user data
        const user = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: userId }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if email is already used by another user
        const existingUser = await prisma.wP_USER_REGISTRATION.findFirst({
            where: {
                Email: email,
                ID: { not: userId }
            }
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email is already in use by another user'
            });
        }

        // Prepare update data
        const updateData = {
            FullName: fullName,
            Email: email,
            Phone: phone || user.Phone,
            UpdateTS: new Date()
        };

        // If changing password, verify current password first
        if (newPassword && currentPassword) {
            const isPasswordValid = await bcrypt.compare(currentPassword, user.Password);
            if (!isPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Hash new password
            const saltRounds = 10;
            updateData.Password = await bcrypt.hash(newPassword, saltRounds);
        }

        // Update user profile
        await prisma.wP_USER_REGISTRATION.update({
            where: { ID: userId },
            data: updateData
        });

        // Log the action
        await prisma.wP_LOGS.create({
            data: {
                Description: `User ${user.Username} updated their profile`,
                CreateTS: new Date().toISOString(),
                LoggedUser: user.Username,
                Action: ACTIONS.PROFILE_UPDATE,
                IPAddress: req.ip,
                LogType: LOG_TYPES.INFO,
                Module: MODULES.USER,
                Status: STATUS.SUCCESS,
                UserID: userId
            }
        });

        // Fetch updated user
        const updatedUser = await prisma.wP_USER_REGISTRATION.findUnique({
            where: { ID: userId },
            select: {
                ID: true,
                FullName: true,
                Email: true,
                Username: true,
                Phone: true,
                Admin: true,
                ValidStatus: true,
                LastLoginTime: true,
                ProfilePicture: true
            }
        });

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
});

// Update profile picture (base64 method)
router.post('/update-profile-picture', async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        const userId = req.session.user.id;
        const { profilePicture } = req.body;

        if (!profilePicture) {
            return res.status(400).json({
                success: false,
                message: 'Profile picture is required'
            });
        }

        // Update profile picture
        await prisma.wP_USER_REGISTRATION.update({
            where: { ID: userId },
            data: {
                ProfilePicture: profilePicture,
                UpdateTS: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Profile picture updated successfully',
            profilePicture
        });
    } catch (error) {
        console.error('Error updating profile picture:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile picture',
            error: error.message
        });
    }
});

// Update avatar with file upload
router.post('/update-avatar', avatarUpload.single('avatar'), async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No avatar file uploaded'
            });
        }

        const userId = req.session.user.id;

        // Get the relative path to the uploaded file
        const avatarPath = '/uploads/avatars/' + path.basename(req.file.path);

        // Update user profile with the new avatar path
        await prisma.wP_USER_REGISTRATION.update({
            where: { ID: userId },
            data: {
                ProfilePicture: avatarPath,
                UpdateTS: new Date()
            }
        });

        // Log the action
        await prisma.wP_LOGS.create({
            data: {
                Description: `User ${req.session.user.username} updated their avatar`,
                CreateTS: new Date().toISOString(),
                LoggedUser: req.session.user.username,
                Action: 'UPDATE_PROFILE',
                IPAddress: req.ip,
                LogType: 'INFO',
                Module: 'USER',
                Status: 'SUCCESS',
                UserID: userId
            }
        });

        res.json({
            success: true,
            message: 'Avatar updated successfully',
            avatarUrl: avatarPath
        });
    } catch (error) {
        console.error('Error updating avatar:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update avatar',
            error: error.message
        });
    }
});

// Update notification settings
router.post('/update-notifications', async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated'
            });
        }

        const userId = req.session.user.id;
        const { notificationsEnabled, twoFactorEnabled } = req.body;

        // Update notification settings
        await prisma.wP_USER_REGISTRATION.update({
            where: { ID: userId },
            data: {
                NotificationsEnabled: notificationsEnabled !== undefined ? notificationsEnabled : undefined,
                TwoFactorEnabled: twoFactorEnabled !== undefined ? twoFactorEnabled : undefined,
                UpdateTS: new Date()
            }
        });

        res.json({
            success: true,
            message: 'Notification settings updated successfully',
            settings: {
                notificationsEnabled,
                twoFactorEnabled
            }
        });
    } catch (error) {
        console.error('Error updating notification settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification settings',
            error: error.message
        });
    }
});

// Get online users
router.get('/online-users', async (req, res) => {
    try {
        // Get users who have logged in within the last hour
        const onlineUsers = await prisma.wP_USER_REGISTRATION.findMany({
            where: {
                LastLoginTime: {
                    gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
                },
                ValidStatus: '1'
            },
            select: {
                ID: true,
                Username: true,
                Email: true,
                FullName: true,
                LastLoginTime: true,
                ProfilePicture: true,
                Admin: true
            },
            orderBy: {
                LastLoginTime: 'desc'
            }
        });

        const formattedUsers = onlineUsers.map(user => ({
            id: user.ID,
            username: user.Username,
            email: user.Email,
            fullName: user.FullName || user.Username,
            lastActivity: user.LastLoginTime ? new Date(user.LastLoginTime).toISOString() : null,
            profilePicture: user.ProfilePicture,
            isAdmin: user.Admin === 1
        }));

        // Get total user count
        const totalUsers = await prisma.wP_USER_REGISTRATION.count({
            where: {
                ValidStatus: '1'
            }
        });

        res.json({
            success: true,
            total: totalUsers,
            active: onlineUsers.length,
            online_count: onlineUsers.length,
            users: formattedUsers
        });
    } catch (error) {
        console.error('Error fetching online users:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch online users',
            total: 0,
            active: 0,
            online_count: 0,
            users: []
        });
    }
});

// Session info endpoint
router.get('/session-info', async (req, res) => {
    try {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                message: 'Not authenticated',
                authenticated: false
            });
        }

        // Get token expiry time
        const tokenExpiryTime = req.session.tokenExpiryTime || null;
        const now = Date.now();
        const tokenValid = tokenExpiryTime && tokenExpiryTime > now;

        res.json({
            success: true,
            authenticated: true,
            user: {
                id: req.session.user.id,
                username: req.session.user.username,
                admin: req.session.user.admin,
                fullName: req.session.user.fullName
            },
            session: {
                createdAt: req.session.createdAt,
                lastActivity: req.session.lastActivity,
                expiresAt: req.session.cookie.expires,
                maxAge: req.session.cookie.maxAge
            },
            token: {
                valid: tokenValid,
                expiresAt: tokenExpiryTime ? new Date(tokenExpiryTime).toISOString() : null,
                timeRemaining: tokenExpiryTime ? Math.floor((tokenExpiryTime - now) / 1000) : 0
            }
        });
    } catch (error) {
        console.error('Error fetching session info:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch session info',
            authenticated: false
        });
    }
});

// Lightweight session check endpoint for frontend
router.get('/check-session', auth.isApiAuthenticated, async (req, res) => {
    try {
        // If we get here, the auth middleware has already verified the session
        res.json({
            success: true,
            authenticated: true,
            username: req.session.user.username
        });
    } catch (error) {
        console.error('Error checking session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check session'
        });
    }
});

// Check for active session by username (no auth required)
router.post('/check-session', async (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({
                success: false,
                message: 'Username is required'
            });
        }

        // Check if there's an active session for this user
        const hasActiveSession = auth.checkActiveSession(username);

        res.json({
            success: true,
            hasActiveSession
        });
    } catch (error) {
        console.error('Error checking for active session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check for active session'
        });
    }
});

// Session extension endpoint
router.post('/extend-session', auth.isApiAuthenticated, async (req, res) => {
    try {
        // Extend the session by updating the cookie expiry
        if (req.session && req.session.cookie) {
            req.session.cookie.maxAge = req.session.cookie.originalMaxAge || 30 * 60 * 1000; // 30 minutes or original setting

            // Update last activity timestamp
            req.session.lastActivity = Date.now();

            // Save the session
            req.session.save();

            // Update active session in auth middleware
            if (req.session.user && req.session.user.username) {
                auth.updateActiveSession(req.session.user.username, req);
            }
        }

        res.json({
            success: true,
            message: 'Session extended successfully',
            sessionInfo: {
                username: req.session.user.username,
                fullName: req.session.user.fullName,
                expiresAt: req.session.cookie.expires
            }
        });
    } catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to extend session'
        });
    }
});

module.exports = router;
