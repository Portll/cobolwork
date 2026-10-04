KEYZERO  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING KEYZERO,12
         MODESET EXTKEY=ZERO,SAVEKEY=(2),WORKREG=2
         L     3,0(,1)
         MVC   0(16,3),PSA
         MODESET KEYREG=2
         LM    14,12,12(13)
         SR    15,15
         BR    14
PSA      DS    CL16
         END
