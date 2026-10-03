ATTACHBYNAME CSECT
             STM   14,12,12(13)
             LR    12,15
             USING ATTACHBYNAME,12
             LA    1,MODNAME
             ATTACH EPLOC=(1)
             LM    14,12,12(13)
             SR    15,15
             BR    14
MODNAME    DC    CL8'HELLO'
             END
