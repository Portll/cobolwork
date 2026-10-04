HELLO    CSECT
         STM   14,12,12(13)
         LR    12,15
         USING HELLO,12
         L     1,0(,1)
         MVC   0(8,1),MSG
         LM    14,12,12(13)
         SR    15,15
         BR    14
MSG      DC    CL8'HELLO'
         END
