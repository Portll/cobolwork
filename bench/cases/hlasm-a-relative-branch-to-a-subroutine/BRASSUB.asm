BRASSUB  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING BRASSUB,12
         BRAS  14,SUB
         LM    14,12,12(13)
         SR    15,15
         BR    14
SUB      CLC   KEY(64),KEY
         BR    14
KEY      DS    CL64
         END
