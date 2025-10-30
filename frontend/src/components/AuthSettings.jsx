import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography } from '@mui/material';

export default function AuthSettings({ open, onClose, onSave, initialCredentials }) {
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
    clientId: '',
    clientSecret: ''
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (initialCredentials) {
      setCredentials(prev => ({
        ...prev,
        ...initialCredentials
      }));
    }
  }, [initialCredentials]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!credentials.username) newErrors.username = 'Username is required';
    if (!credentials.password) newErrors.password = 'Password is required';
    if (!credentials.clientId) newErrors.clientId = 'Client ID is required';
    if (!credentials.clientSecret) newErrors.clientSecret = 'Client Secret is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      onSave(credentials);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Environment Southland Authentication</DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" paragraph>
            Enter your Environment Southland ArcGIS Enterprise credentials to access additional map layers.
          </Typography>
          
          <TextField
            margin="normal"
            fullWidth
            label="Username"
            name="username"
            value={credentials.username}
            onChange={handleChange}
            error={!!errors.username}
            helperText={errors.username}
          />
          
          <TextField
            margin="normal"
            fullWidth
            label="Password"
            name="password"
            type="password"
            value={credentials.password}
            onChange={handleChange}
            error={!!errors.password}
            helperText={errors.password}
          />
          
          <TextField
            margin="normal"
            fullWidth
            label="Client ID"
            name="clientId"
            value={credentials.clientId}
            onChange={handleChange}
            error={!!errors.clientId}
            helperText={errors.clientId || "Obtain this from Environment Southland IT"}
          />
          
          <TextField
            margin="normal"
            fullWidth
            label="Client Secret"
            name="clientSecret"
            type="password"
            value={credentials.clientSecret}
            onChange={handleChange}
            error={!!errors.clientSecret}
            helperText={errors.clientSecret || "Keep this secure and do not share"}
          />
          
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Note: Credentials are stored locally in your browser and only sent to Environment Southland's servers.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" color="primary">
          Save Credentials
        </Button>
      </DialogActions>
    </Dialog>
  );
}

AuthSettings.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  initialCredentials: PropTypes.shape({
    username: PropTypes.string,
    password: PropTypes.string,
    clientId: PropTypes.string,
    clientSecret: PropTypes.string
  })
};
